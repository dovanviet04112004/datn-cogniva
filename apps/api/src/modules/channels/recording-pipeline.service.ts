/**
 * RecordingPipelineService — download MP4 → Whisper transcribe → summarize →
 * chapter detect → persist → post log message + broadcast.
 *
 * Port từ apps/web/src/lib/recording/inline-pipeline.ts (+ lib/media/whisper.ts,
 * lib/ai/summarize.ts, lib/media/chapters.ts). Khác bản web:
 *   - Whisper gọi REST multipart trực tiếp (api không cài SDK openai) — cùng
 *     endpoint OpenAI-compatible, Groq free ưu tiên trước OpenAI paid.
 *   - Không ghi tmp file: bản cũ buffer toàn bộ MP4 rồi mới ghi disk cho
 *     createReadStream; ở đây gửi thẳng buffer qua FormData (memory như cũ).
 *   - summarize qua LlmService (provider pick order y models.ts cũ), chapter
 *     embedding qua EmbeddingService.embedQuery (= embed-query.ts cũ).
 *
 * Chạy sync trong request /record/:id/sync — 1-3 phút, api không có giới hạn
 * maxDuration kiểu serverless nên không cần config thêm.
 */
import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { logger } from '@cogniva/server-core';
import { triggerEvent } from '@cogniva/server-core/realtime-emitter';

import { PrismaService } from '../../infra/database/prisma.service';
import { EmbeddingService } from '../../infra/ai/embedding.service';
import { LlmService } from '../../infra/ai/llm.service';

export type InlinePipelineOpts = {
  recordingId: string;
  fileUrl: string;
  channelId: string;
  /** Duration từ LiveKit egress info — fallback nếu Whisper không trả. */
  durationHint?: number;
};

export type InlinePipelineResult = {
  ok: boolean;
  transcriptLength: number;
  chapterCount: number;
  error?: string;
};

type TranscribeSegment = { start: number; end: number; text: string };

type TranscribeResult = {
  text: string;
  segments: TranscribeSegment[];
  language: string;
  duration: number;
};

type Chapter = {
  startSec: number;
  endSec: number;
  title: string;
  preview: string;
};

/* ── Summarize (NGUỒN CHUẨN prompt ở apps/web/src/lib/ai/summarize.ts) ──── */

const CHUNK_WORD_LIMIT = 5_000;
const SINGLE_SHOT_THRESHOLD = 8_000;

const SUMMARY_SYSTEM_PROMPT = `Bạn là trợ lý tóm tắt buổi học cho học sinh/sinh viên Việt Nam.
Tóm tắt bằng TIẾNG VIỆT, format markdown:

**Tóm tắt** (3-5 câu nội dung chính)

**Điểm nổi bật**
- Bullet 1 (concept quan trọng, kèm 1-2 câu giải thích)
- Bullet 2
- Bullet 3-5

**Cần ôn lại**
- Concept/công thức/định lý đáng note

Quy tắc:
- Tổng ≤ 300 từ.
- Không bịa fact ngoài transcript.
- Giữ NGUYÊN tên riêng + công thức + số liệu.`;

function approxWordCount(text: string): number {
  return text.trim().split(/\s+/).length;
}

function chunkByWords(text: string, maxWords: number): string[] {
  const words = text.split(/\s+/);
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += maxWords) {
    chunks.push(words.slice(i, i + maxWords).join(' '));
  }
  return chunks;
}

/* ── Chapter detection (NGUỒN CHUẨN ở apps/web/src/lib/media/chapters.ts) ─ */

/** Cosine similarity — trả -1 nếu zero vector (tránh chia 0). */
function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return -1;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  if (normA === 0 || normB === 0) return -1;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** Group segments thành blocks ~blockSec giây (≈ 1 đoạn nói tự nhiên). */
function buildBlocks(
  segments: TranscribeSegment[],
  blockSec: number,
): Array<{ start: number; end: number; text: string }> {
  const blocks: Array<{ start: number; end: number; text: string }> = [];
  let cur: { start: number; end: number; text: string } | null = null;

  for (const s of segments) {
    if (!cur) {
      cur = { start: s.start, end: s.end, text: s.text };
      continue;
    }
    if (s.end - cur.start <= blockSec) {
      cur.end = s.end;
      cur.text += ' ' + s.text;
    } else {
      blocks.push(cur);
      cur = { start: s.start, end: s.end, text: s.text };
    }
  }
  if (cur) blocks.push(cur);
  return blocks;
}

function makeTitle(text: string): string {
  const words = text.trim().split(/\s+/).slice(0, 10);
  if (words.length === 0) return 'Chương';
  const raw = words.join(' ').replace(/[.,;!?]+$/, '').trim();
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

/**
 * Chia transcript thành chapter theo topic shift: embed blocks 75s, cosine
 * giữa block kề nhau < 0.65 = boundary; merge chapter < 120s với chapter trước.
 * Embedding-based thay vì LLM end-to-end vì rẻ + deterministic.
 */
async function detectChapters(
  segments: TranscribeSegment[],
  embedFn: (text: string) => Promise<number[]>,
): Promise<Chapter[]> {
  const blockSec = 75;
  const similarityThreshold = 0.65;
  const minChapterSec = 120;

  if (segments.length === 0) return [];

  const blocks = buildBlocks(segments, blockSec);
  if (blocks.length <= 1) {
    const onlyBlock = blocks[0]!;
    return [
      {
        startSec: onlyBlock.start,
        endSec: onlyBlock.end,
        title: makeTitle(onlyBlock.text),
        preview: onlyBlock.text.slice(0, 200),
      },
    ];
  }

  const embeddings = await Promise.all(blocks.map((b) => embedFn(b.text)));

  const boundaryIdx: number[] = [0];
  for (let i = 1; i < blocks.length; i++) {
    const sim = cosine(embeddings[i - 1]!, embeddings[i]!);
    if (sim < similarityThreshold) boundaryIdx.push(i);
  }

  const chapters: Chapter[] = [];
  for (let k = 0; k < boundaryIdx.length; k++) {
    const startBlockIdx = boundaryIdx[k]!;
    const endBlockIdx = k + 1 < boundaryIdx.length ? boundaryIdx[k + 1]! - 1 : blocks.length - 1;
    const startBlock = blocks[startBlockIdx]!;
    const endBlock = blocks[endBlockIdx]!;
    const text = blocks
      .slice(startBlockIdx, endBlockIdx + 1)
      .map((b) => b.text)
      .join(' ');

    const candidate: Chapter = {
      startSec: Math.floor(startBlock.start),
      endSec: Math.ceil(endBlock.end),
      title: makeTitle(text),
      preview: text.slice(0, 200),
    };

    const last = chapters[chapters.length - 1];
    if (last && candidate.endSec - last.startSec < minChapterSec) {
      // Merge với previous (giữ title prev — coi như chương cũ kéo dài)
      last.endSec = candidate.endSec;
      last.preview = (last.preview + ' ' + candidate.preview).slice(0, 200);
    } else {
      chapters.push(candidate);
    }
  }

  return chapters;
}

@Injectable()
export class RecordingPipelineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly embedding: EmbeddingService,
  ) {}

  /**
   * Full pipeline: download → transcribe → summarize → chapters → persist →
   * post log message → broadcast. KHÔNG throw — fail set DB FAILED + trả
   * error trong result (caller đưa vào field pipelineError).
   */
  async run(opts: InlinePipelineOpts): Promise<InlinePipelineResult> {
    const { recordingId, fileUrl, channelId, durationHint } = opts;

    try {
      logger.info('recording.pipeline.start', { recording_id: recordingId, channel_id: channelId });

      await this.prisma.recording.update({
        where: { id: recordingId },
        data: { status: 'PROCESSING' },
      });

      // ── Download MP4 ──
      const res = await fetch(fileUrl);
      if (!res.ok) {
        throw new Error(`Download MP4 thất bại — status ${res.status} từ ${fileUrl}`);
      }
      const buf = Buffer.from(await res.arrayBuffer());
      logger.info('recording.pipeline.downloaded', { size_bytes: buf.byteLength });

      // ── Transcribe (Whisper nhận MP4 native — không cần ffmpeg) ──
      let transcriptText = '';
      let segments: TranscribeSegment[] = [];
      let durationSec = durationHint ?? 0;

      if (this.isWhisperConfigured()) {
        const result = await this.whisperTranscribe(buf);
        transcriptText = result.text;
        segments = result.segments;
        durationSec = result.duration || durationSec;
        logger.info('recording.pipeline.transcribed', {
          len_chars: transcriptText.length,
          segments: segments.length,
        });
      } else {
        logger.warn('recording.pipeline.whisper-not-configured', { recording_id: recordingId });
      }

      // ── Summarize (fail riêng không chặn pipeline) ──
      let summary: string | null = null;
      if (transcriptText.trim()) {
        try {
          summary = await this.summarizeTranscript(transcriptText);
        } catch (err) {
          logger.error('recording.pipeline.summarize-fail', {
            err: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // ── Chapters (chỉ khi có segments) ──
      let chapters: Chapter[] = [];
      if (segments.length > 0) {
        try {
          chapters = await detectChapters(segments, (text) => this.embedding.embedQuery(text));
        } catch (err) {
          logger.error('recording.pipeline.chapters-fail', {
            err: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // ── Persist ──
      await this.prisma.recording.update({
        where: { id: recordingId },
        data: {
          transcript: transcriptText || null,
          summary: summary || null,
          chapters:
            chapters.length > 0 ? (chapters as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
          ...(durationSec > 0 ? { duration_seconds: Math.round(durationSec) } : {}),
          status: 'PROCESSED',
          ended_at: new Date(),
        },
      });

      // ── Resolve log channel: group.recording_log_channel_id (verify cùng
      // group) → fallback TEXT channel đầu tiên ──
      const voiceCh = await this.prisma.study_group_channel.findUnique({
        where: { id: channelId },
        select: { group_id: true, name: true },
      });

      let logChannelId: string | null = null;
      if (voiceCh) {
        const grp = await this.prisma.study_group.findUnique({
          where: { id: voiceCh.group_id },
          select: { recording_log_channel_id: true },
        });

        if (grp?.recording_log_channel_id) {
          const conf = await this.prisma.study_group_channel.findFirst({
            where: { id: grp.recording_log_channel_id, group_id: voiceCh.group_id },
            select: { id: true },
          });
          if (conf) logChannelId = conf.id;
        }

        if (!logChannelId) {
          const firstText = await this.prisma.study_group_channel.findFirst({
            where: { group_id: voiceCh.group_id, type: 'TEXT' },
            orderBy: [{ position: 'asc' }, { created_at: 'asc' }],
            select: { id: true },
          });
          if (firstText) logChannelId = firstText.id;
        }
      }

      if (logChannelId) {
        const summaryPreview = summary
          ? summary.length > 300
            ? summary.slice(0, 300) + '…'
            : summary
          : '_(Chưa tóm tắt được — xem transcript đầy đủ trong recording.)_';
        const durationFmt =
          durationSec > 0
            ? `${Math.floor(durationSec / 60)}:${String(Math.round(durationSec % 60)).padStart(2, '0')}`
            : '?';
        const content = [
          `📼 **Recording mới từ #${voiceCh?.name ?? 'voice'} — ${durationFmt}**`,
          '',
          summaryPreview,
          '',
          `[Xem recording đầy đủ](/groups/recordings/${recordingId})`,
        ].join('\n');

        const msg = await this.prisma.study_group_message.create({
          data: {
            // id sinh app-side (Drizzle cũ $defaultFn cuid2 — DB không có default)
            id: randomUUID(),
            channel_id: logChannelId,
            author_id: 'system-ai-tutor',
            content,
            content_type: 'markdown',
          },
          select: { id: true, channel_id: true, author_id: true, content: true, created_at: true },
        });

        await triggerEvent(`private-channel-${logChannelId}`, 'message:new', {
          id: msg.id,
          channelId: msg.channel_id,
          authorId: msg.author_id,
          authorName: 'AI Tutor',
          authorImage: null,
          content: msg.content,
          contentType: 'markdown',
          replyToId: null,
          attachments: null,
          reactions: null,
          mentions: null,
          pinned: false,
          editedAt: null,
          deletedAt: null,
          createdAt: msg.created_at,
        });
      } else {
        logger.warn('recording.pipeline.no-log-channel', { recording_id: recordingId });
      }

      // ── Notify replay UI ──
      await triggerEvent(`presence-voice-${channelId}`, 'recording:processed', {
        recordingId,
        summary,
        chapterCount: chapters.length,
        flashcardCount: 0,
      });
      if (voiceCh) {
        await triggerEvent(`presence-group-${voiceCh.group_id}`, 'message:new-in-channel', {
          channelId: logChannelId ?? channelId,
          authorId: 'system-ai-tutor',
          messageId: null,
        });
      }

      logger.info('recording.pipeline.done', { recording_id: recordingId });
      return {
        ok: true,
        transcriptLength: transcriptText.length,
        chapterCount: chapters.length,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('recording.pipeline.fail', { err: msg, recording_id: recordingId });
      await this.prisma.recording.update({
        where: { id: recordingId },
        data: { status: 'FAILED' },
      });
      return { ok: false, transcriptLength: 0, chapterCount: 0, error: msg };
    }
  }

  /** Pipeline có thể skip transcribe thay vì throw (replay vẫn xem được video). */
  private isWhisperConfigured(): boolean {
    return !!process.env.GROQ_API_KEY || !!process.env.OPENAI_API_KEY;
  }

  /**
   * Whisper qua REST multipart (OpenAI-compatible). Priority y lib cũ:
   * Groq free (whisper-large-v3-turbo) → OpenAI paid (whisper-1).
   * verbose_json để có segment timestamps cho chapter detection.
   */
  private async whisperTranscribe(buf: Buffer): Promise<TranscribeResult> {
    const groqKey = process.env.GROQ_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;

    let baseURL: string;
    let apiKey: string;
    let model: string;
    if (groqKey) {
      baseURL = 'https://api.groq.com/openai/v1';
      apiKey = groqKey;
      model = 'whisper-large-v3-turbo';
    } else if (openaiKey) {
      baseURL = 'https://api.openai.com/v1';
      apiKey = openaiKey;
      model = 'whisper-1';
    } else {
      throw new Error(
        'Whisper chưa cấu hình — set GROQ_API_KEY (free) hoặc OPENAI_API_KEY (paid).',
      );
    }

    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(buf)], { type: 'video/mp4' }), 'recording.mp4');
    form.append('model', model);
    form.append('language', 'vi');
    form.append('response_format', 'verbose_json');

    const res = await fetch(`${baseURL}/audio/transcriptions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (!res.ok) {
      throw new Error(`whisper ${res.status}`);
    }

    const raw = (await res.json()) as {
      text: string;
      language?: string;
      duration?: number;
      segments?: Array<{ start: number; end: number; text: string }>;
    };

    return {
      text: raw.text,
      language: raw.language ?? 'vi',
      duration: raw.duration ?? 0,
      segments: (raw.segments ?? []).map((s) => ({
        start: s.start,
        end: s.end,
        text: s.text.trim(),
      })),
    };
  }

  /**
   * Tóm tắt transcript: < 8K từ → 1 shot; dài hơn → map-reduce chunk 5K từ.
   * maxTokens 1024 đủ cho output ≤ 300 từ.
   */
  private async summarizeTranscript(transcript: string): Promise<string> {
    const wordCount = approxWordCount(transcript);

    if (wordCount <= SINGLE_SHOT_THRESHOLD) {
      return this.llm.complete(
        `Transcript buổi học:\n\n${transcript}\n\nTóm tắt theo format yêu cầu.`,
        { system: SUMMARY_SYSTEM_PROMPT },
      );
    }

    const chunks = chunkByWords(transcript, CHUNK_WORD_LIMIT);
    const partials = await Promise.all(
      chunks.map((chunk, i) =>
        this.llm.complete(`Phần ${i + 1}/${chunks.length}:\n\n${chunk}`, {
          system:
            'Bạn là trợ lý tóm tắt. Tóm tắt đoạn transcript sau thành 100 từ, giữ tên riêng + số liệu.',
        }),
      ),
    );

    return this.llm.complete(
      `Các tóm tắt từng phần của buổi học (gộp lại thành summary cuối):\n\n${partials
        .map((p, i) => `[Phần ${i + 1}]\n${p}`)
        .join('\n\n')}`,
      { system: SUMMARY_SYSTEM_PROMPT },
    );
  }
}
