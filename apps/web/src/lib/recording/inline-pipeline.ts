/**
 * Inline recording pipeline — chạy ngay trong Next.js route handler thay vì
 * qua BullMQ worker. Dev không cần worker chạy parallel.
 *
 * Khác BullMQ worker version (process-recording.ts):
 *   - KHÔNG cần ffmpeg — send MP4 thẳng cho Whisper API (OpenAI hỗ trợ mp4)
 *   - KHÔNG cần ffprobe — duration lấy từ Whisper response hoặc LiveKit egress info
 *   - KHÔNG retry tự động (BullMQ worker có) — caller có thể gọi lại tay
 *   - KHÔNG persistent state (BullMQ worker có) — fail giữa chừng cần Retry full
 *
 * Trade-off: route handler chạy 1-3 phút sync, browser/webhook chờ. Cần set
 * `export const maxDuration = 300` (5 phút) ở route.
 *
 * Production có thể switch sang BullMQ worker version để có retry + observability.
 */
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { and, asc, eq } from 'drizzle-orm';

import {
  db,
  recording,
  studyGroup,
  studyGroupChannel,
  studyGroupMessage,
} from '@cogniva/db';

import { whisperTranscribe, isWhisperConfigured } from '@/lib/media/whisper';
import { summarizeTranscript } from '@/lib/ai/summarize';
import { detectChapters, type Chapter } from '@/lib/media/chapters';
import { embedQuery } from '@/lib/ingest/embed-query';
import { triggerEvent } from '@/lib/realtime-server';
import { logger } from '@/lib/observability/logger';

/**
 * Download URL về tmp file. Trả về đường dẫn local + duration MP4 (giây).
 */
async function downloadToTmp(url: string): Promise<{ path: string; sizeBytes: number }> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Download MP4 thất bại — status ${res.status} từ ${url}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const tmpPath = path.join(tmpdir(), `cogniva-rec-${randomUUID()}.mp4`);
  await fs.writeFile(tmpPath, buf);
  return { path: tmpPath, sizeBytes: buf.byteLength };
}

/** Best-effort xoá tmp file — không throw nếu fail. */
async function safeUnlink(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch {
    // ignore
  }
}

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

/**
 * Chạy full pipeline: download → transcribe → chapter → summarize → persist
 * → post log message → broadcast.
 *
 * Throws nếu pipeline fail nghiêm trọng (DB set FAILED). Caller catch + log.
 */
export async function runRecordingPipeline(
  opts: InlinePipelineOpts,
): Promise<InlinePipelineResult> {
  const { recordingId, fileUrl, channelId, durationHint } = opts;
  let tmpPath: string | null = null;

  try {
    console.log('[inline-pipeline] START', { recordingId, channelId, fileUrl });
    logger.info('[inline-pipeline] start', { recordingId, channelId });

    // ── 1. Mark PROCESSING ─────────────────────────
    await db
      .update(recording)
      .set({ status: 'PROCESSING' })
      .where(eq(recording.id, recordingId));
    console.log('[inline-pipeline] marked PROCESSING');

    // ── 2. Download MP4 ────────────────────────────
    console.log('[inline-pipeline] downloading MP4...', fileUrl);
    const dl = await downloadToTmp(fileUrl);
    tmpPath = dl.path;
    console.log('[inline-pipeline] downloaded OK', {
      sizeBytes: dl.sizeBytes,
      tmpPath: dl.path,
    });
    logger.info('[inline-pipeline] downloaded', { sizeBytes: dl.sizeBytes });

    // ── 3. Transcribe (Whisper hỗ trợ MP4 native — không cần ffmpeg) ──
    let transcriptText = '';
    let segments: Array<{ start: number; end: number; text: string }> = [];
    let durationSec = durationHint ?? 0;

    if (isWhisperConfigured()) {
      console.log('[inline-pipeline] calling Whisper (Groq/OpenAI)...');
      const result = await whisperTranscribe(tmpPath, { language: 'vi' });
      transcriptText = result.text;
      segments = result.segments;
      durationSec = result.duration || durationSec;
      console.log('[inline-pipeline] transcribed OK', {
        lenChars: transcriptText.length,
        segments: segments.length,
        durationSec,
      });
    } else {
      console.warn('[inline-pipeline] Whisper KHÔNG cấu hình — bỏ qua transcribe');
    }

    // ── 4. Summarize ───────────────────────────────
    let summary: string | null = null;
    if (transcriptText.trim()) {
      try {
        console.log('[inline-pipeline] summarizing...');
        summary = await summarizeTranscript(transcriptText);
        console.log('[inline-pipeline] summarized OK', { lenChars: summary?.length ?? 0 });
      } catch (err) {
        console.error('[inline-pipeline] summarize FAIL', err);
        logger.error('[inline-pipeline] summarize fail', {
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // ── 5. Detect chapters (chỉ khi có segments) ──
    let chapters: Chapter[] = [];
    if (segments.length > 0) {
      try {
        chapters = await detectChapters(segments, {
          embedFn: (text) => embedQuery(text),
        });
      } catch (err) {
        logger.error('[inline-pipeline] chapters fail', {
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // ── 6. Persist ─────────────────────────────────
    await db
      .update(recording)
      .set({
        transcript: transcriptText || null,
        summary: summary || null,
        chapters: chapters.length > 0 ? chapters : null,
        duration: durationSec > 0 ? Math.round(durationSec) : undefined,
        status: 'PROCESSED',
        endedAt: new Date(),
      })
      .where(eq(recording.id, recordingId));

    // ── 7. Resolve log channel + post message ──────
    const [voiceCh] = await db
      .select({ groupId: studyGroupChannel.groupId, name: studyGroupChannel.name })
      .from(studyGroupChannel)
      .where(eq(studyGroupChannel.id, channelId))
      .limit(1);

    let logChannelId: string | null = null;
    if (voiceCh) {
      const [grp] = await db
        .select({ logId: studyGroup.recordingLogChannelId })
        .from(studyGroup)
        .where(eq(studyGroup.id, voiceCh.groupId))
        .limit(1);

      if (grp?.logId) {
        const [conf] = await db
          .select({ id: studyGroupChannel.id })
          .from(studyGroupChannel)
          .where(
            and(
              eq(studyGroupChannel.id, grp.logId),
              eq(studyGroupChannel.groupId, voiceCh.groupId),
            ),
          )
          .limit(1);
        if (conf) logChannelId = conf.id;
      }

      if (!logChannelId) {
        const [firstText] = await db
          .select({ id: studyGroupChannel.id })
          .from(studyGroupChannel)
          .where(
            and(
              eq(studyGroupChannel.groupId, voiceCh.groupId),
              eq(studyGroupChannel.type, 'TEXT'),
            ),
          )
          .orderBy(asc(studyGroupChannel.position), asc(studyGroupChannel.createdAt))
          .limit(1);
        if (firstText) logChannelId = firstText.id;
      }
    }

    console.log('[inline-pipeline] log channel resolved', { logChannelId });
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
      const [msg] = await db
        .insert(studyGroupMessage)
        .values({
          channelId: logChannelId,
          authorId: 'system-ai-tutor',
          content,
          contentType: 'markdown',
        })
        .returning();
      console.log('[inline-pipeline] log message INSERTED', { msgId: msg?.id });
      if (msg) {
        await triggerEvent(`private-channel-${logChannelId}`, 'message:new', {
          id: msg.id,
          channelId: msg.channelId,
          authorId: msg.authorId,
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
          createdAt: msg.createdAt,
        });
      }
    } else {
      logger.warn('[inline-pipeline] không tìm thấy log channel — bỏ qua post message');
    }

    // ── 8. Notify replay UI ────────────────────────
    await triggerEvent(`presence-voice-${channelId}`, 'recording:processed', {
      recordingId,
      summary,
      chapterCount: chapters.length,
      flashcardCount: 0,
    });
    if (voiceCh) {
      await triggerEvent(`presence-group-${voiceCh.groupId}`, 'message:new-in-channel', {
        channelId: logChannelId ?? channelId,
        authorId: 'system-ai-tutor',
        messageId: null,
      });
    }

    console.log('[inline-pipeline] DONE OK', { recordingId });
    return {
      ok: true,
      transcriptLength: transcriptText.length,
      chapterCount: chapters.length,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('[inline-pipeline] fail', { err: msg, recordingId });
    console.error('[inline-pipeline] FAIL', err);
    await db
      .update(recording)
      .set({ status: 'FAILED' })
      .where(eq(recording.id, recordingId));
    return { ok: false, transcriptLength: 0, chapterCount: 0, error: msg };
  } finally {
    if (tmpPath) await safeUnlink(tmpPath);
  }
}
