/**
 * RecordingPipelineService — port từ apps/web/src/jobs/process-recording.ts
 * (BullMQ path, dùng bởi RecordingProcessor) + apps/web/src/lib/recording/
 * inline-pipeline.ts (inline path — webhook LiveKit CÒN Ở WEB tới W6, port
 * sẵn cho cutover).
 *
 * Resilience + idempotency (whole-job retry attempts=2 từ producer):
 *   - Early-return nếu status='PROCESSED' (không tốn Whisper + không dup flashcard).
 *   - Checkpoint transcript ngay sau Whisper → retry bỏ qua download+Whisper.
 *   - Persist PROCESSED + flashcards ATOMIC trong 1 transaction.
 *   - Whisper fail → FAILED nhưng giữ video; chapter/flashcard fail → bỏ qua.
 */
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { triggerEvent } from '@cogniva/server-core/realtime-emitter';
import {
  onDashboardChanged,
  onRoomRecordingsChanged,
} from '@cogniva/server-core/cache/invalidate';

import { PrismaService } from '../../infra/database/prisma.service';
import { EmbeddingService } from '../../infra/ai/embedding.service';
import { FfmpegService } from './media/ffmpeg.service';
import { WhisperService } from './media/whisper.service';
import { detectChapters, type Chapter } from './media/chapters';
import { SummarizeService, type FlashcardDraft } from './summarize.service';

/**
 * Payload job queue `recording` — NGUỒN CHUẨN ở apps/web/src/queue/jobs.ts
 * (RecordingJob, webhook web còn produce tới W6) — đổi thì sửa cả 2.
 */
export type RecordingJob = {
  recordingId: string;
  fileUrl: string;
  egressId?: string;
  r2Key?: string;
  roomId?: string;
  channelId?: string;
  duration?: number;
  fileSize?: number;
};

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

@Injectable()
export class RecordingPipelineService {
  private readonly logger = new Logger(RecordingPipelineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly embedding: EmbeddingService,
    private readonly ffmpeg: FfmpegService,
    private readonly whisper: WhisperService,
    private readonly summarize: SummarizeService,
  ) {}

  /** BullMQ job `process` — pipeline đầy đủ (ffmpeg tách audio + flashcards). */
  async processRecording(data: RecordingJob) {
    const { recordingId, fileUrl, roomId, channelId } = data;

    // Checkpoint: đọc state hiện tại của recording.
    const existing = await this.prisma.recording.findUnique({
      where: { id: recordingId },
      select: { status: true, transcript: true, chapters: true, duration_seconds: true },
    });

    if (!existing) {
      this.logger.warn(`[process-recording] recording không tồn tại, skip ${recordingId}`);
      return { recordingId, skipped: 'not-found' };
    }
    // Đã xử lý xong ở lần chạy trước (retry sau khi persist) → KHÔNG làm lại.
    if (existing.status === 'PROCESSED') {
      this.logger.log(`[process-recording] đã PROCESSED, skip (idempotent) ${recordingId}`);
      return { recordingId, skipped: 'already-processed' };
    }

    const tmpPaths: string[] = [];
    // True sau khi đã commit PROCESSED (+ flashcards) → catch KHÔNG revert FAILED.
    let persisted = false;

    try {
      let duration = existing.duration_seconds ?? 0;
      let transcriptText = existing.transcript ?? '';
      let summary: string | null = null;
      let chapters: Chapter[] = Array.isArray(existing.chapters)
        ? (existing.chapters as unknown as Chapter[])
        : [];

      // ── 1-2. Download + extract audio + Whisper — CHỈ khi chưa có transcript ──
      if (!transcriptText.trim()) {
        const audioPath = await this.ffmpeg.extractAudio(fileUrl);
        this.logger.log(`[process-recording] audio extracted: ${audioPath}`);
        tmpPaths.push(audioPath);

        duration = await this.ffmpeg.getMediaDuration(audioPath);

        // Update sớm: status=PROCESSING + duration để user thấy progress
        await this.prisma.recording.updateMany({
          where: { id: recordingId },
          data: { status: 'PROCESSING', duration_seconds: Math.round(duration) },
        });

        const transcribeResult = this.whisper.isConfigured()
          ? await this.whisper.transcribe(audioPath, { language: 'vi' })
          : null;
        if (!transcribeResult) {
          this.logger.warn('[process-recording] Whisper chưa cấu hình — skip transcribe');
        }
        transcriptText = transcribeResult?.text ?? '';
        const segments = transcribeResult?.segments ?? [];

        // Checkpoint: persist transcript NGAY sau Whisper → retry bỏ qua bước đắt này.
        // updateMany: Drizzle update là no-op nếu row biến mất (không throw P2025).
        if (transcriptText.trim()) {
          await this.prisma.recording.updateMany({
            where: { id: recordingId },
            data: { transcript: transcriptText },
          });
        }

        // Detect chapters cần segments (chỉ có ở lần Whisper này).
        if (segments.length > 0) {
          try {
            chapters = await detectChapters(segments, {
              embedFn: (text) => this.embedding.embedQuery(text),
            });
          } catch (err) {
            this.logger.error(`process-recording.chapter-fail: ${err}`);
            chapters = [];
          }
        }
      } else {
        this.logger.log(
          `[process-recording] reuse transcript đã persist (skip download+Whisper) ${recordingId}`,
        );
      }

      // ── 3. Summarize (skip nếu transcript rỗng) ──
      if (transcriptText.trim()) {
        try {
          summary = await this.summarize.summarizeTranscript(transcriptText);
        } catch (err) {
          this.logger.error(`process-recording.summarize-fail: ${err}`);
          summary = null;
        }
      }

      // ── 5. Generate flashcards ──
      let flashcardDrafts: FlashcardDraft[] = [];
      if (transcriptText.trim()) {
        try {
          flashcardDrafts = await this.summarize.generateFlashcardsFromTranscript(
            transcriptText,
            10,
          );
        } catch (err) {
          this.logger.error(`process-recording.flashcard-fail: ${err}`);
          flashcardDrafts = [];
        }
      }

      // ── 6. Persist — ATOMIC: status=PROCESSED ⟺ flashcards (1 transaction) ──
      const rec = await this.prisma.recording.findUnique({
        where: { id: recordingId },
        select: { id: true },
      });
      if (rec) {
        // Owner để gắn flashcard (chỉ room recording — channel nhiều owner, skip).
        let flashcardOwnerId: string | null = null;
        if (flashcardDrafts.length > 0 && roomId) {
          const owner = await this.prisma.room.findUnique({
            where: { id: roomId },
            select: { owner_id: true },
          });
          flashcardOwnerId = owner?.owner_id ?? null;
        }
        const flashcardValues = flashcardOwnerId
          ? flashcardDrafts.map((c) => ({
              id: randomUUID(),
              user_id: flashcardOwnerId as string,
              front: c.front,
              back: c.back,
              card_type: 'BASIC' as const,
            }))
          : [];

        await this.prisma.$transaction([
          this.prisma.recording.updateMany({
            where: { id: recordingId },
            data: {
              transcript: transcriptText || null,
              summary: summary || null,
              chapters:
                chapters.length > 0
                  ? (chapters as unknown as Prisma.InputJsonValue)
                  : Prisma.DbNull,
              status: 'PROCESSED',
              ended_at: new Date(),
            },
          }),
          ...(flashcardValues.length > 0
            ? [this.prisma.flashcard.createMany({ data: flashcardValues })]
            : []),
        ]);
        persisted = true;

        // Cache invalidation (fail-open) — ngoài transaction.
        if (roomId) await onRoomRecordingsChanged(roomId);
        if (flashcardOwnerId) await onDashboardChanged(flashcardOwnerId);
      } else {
        this.logger.warn(`[process-recording] recording ${recordingId} biến mất, abort persist`);
      }

      // ── 6b. Voice channel: post system message vào log channel ──
      let logChannelId: string | null = null;
      let voiceChannelName = '';
      if (channelId) {
        const voiceCh = await this.prisma.study_group_channel.findUnique({
          where: { id: channelId },
          select: { group_id: true, name: true },
        });
        if (voiceCh) {
          voiceChannelName = voiceCh.name;

          // 1. Try group.recordingLogChannelId
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

          // 2. Fallback: TEXT channel đầu tiên theo position
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
          const durationFmt = duration
            ? `${Math.floor(duration / 60)}:${String(Math.round(duration % 60)).padStart(2, '0')}`
            : '?';
          const content = [
            `📼 **Recording mới từ #${voiceChannelName} — ${durationFmt}**`,
            '',
            summaryPreview,
            '',
            `[Xem recording đầy đủ](/groups/recordings/${recordingId})`,
          ].join('\n');
          const msg = await this.prisma.study_group_message.create({
            data: {
              id: randomUUID(),
              channel_id: logChannelId,
              author_id: 'system-ai-tutor',
              content,
              content_type: 'markdown',
            },
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
          this.logger.warn(
            `[process-recording] không tìm thấy log channel — bỏ qua post message ${channelId}`,
          );
        }
      }

      // ── 7. Notify ──
      const payload = {
        recordingId,
        summary,
        chapterCount: chapters.length,
        flashcardCount: flashcardDrafts.length,
      };
      if (channelId) {
        await triggerEvent(`presence-voice-${channelId}`, 'recording:processed', payload);
        const ch = await this.prisma.study_group_channel.findUnique({
          where: { id: channelId },
          select: { group_id: true },
        });
        if (ch) {
          await triggerEvent(`presence-group-${ch.group_id}`, 'message:new-in-channel', {
            channelId,
            authorId: 'system-ai-tutor',
            messageId: null,
          });
        }
      } else if (roomId) {
        await triggerEvent(`presence-room-${roomId}`, 'recording:processed', payload);
      }

      return {
        recordingId,
        transcriptLength: transcriptText.length,
        chapterCount: chapters.length,
        flashcardCount: flashcardDrafts.length,
      };
    } catch (err) {
      this.logger.error(
        `process-recording.pipeline-fail: ${err instanceof Error ? err.message : String(err)}`,
      );
      // Mark FAILED — user vẫn xem được video. KHÔNG revert nếu đã PROCESSED
      // (lỗi ở bước sau persist) — để retry early-return, tránh dup.
      if (!persisted) {
        await this.prisma.recording.updateMany({
          where: { id: recordingId },
          data: { status: 'FAILED' },
        });
      }
      throw err;
    } finally {
      if (tmpPaths.length > 0) await this.ffmpeg.safeUnlink(...tmpPaths);
    }
  }

  /**
   * Inline pipeline (voice channel) — KHÔNG ffmpeg: gửi MP4 thẳng Whisper,
   * duration từ Whisper hoặc durationHint. Không retry tự động, không
   * checkpoint — fail giữa chừng caller gọi lại tay. Caller hiện tại là
   * webhook LiveKit ở web (tới W6 mới chuyển producer sang api).
   */
  async runRecordingPipeline(opts: InlinePipelineOpts): Promise<InlinePipelineResult> {
    const { recordingId, fileUrl, channelId, durationHint } = opts;
    let tmpPath: string | null = null;

    try {
      this.logger.log(`[inline-pipeline] START ${recordingId} channel=${channelId}`);

      // ── 1. Mark PROCESSING ─────────────────────────
      await this.prisma.recording.updateMany({
        where: { id: recordingId },
        data: { status: 'PROCESSING' },
      });

      // ── 2. Download MP4 ────────────────────────────
      const dl = await this.downloadToTmp(fileUrl);
      tmpPath = dl.path;
      this.logger.log(`[inline-pipeline] downloaded ${dl.sizeBytes} bytes`);

      // ── 3. Transcribe (Whisper hỗ trợ MP4 native — không cần ffmpeg) ──
      let transcriptText = '';
      let segments: Array<{ start: number; end: number; text: string }> = [];
      let durationSec = durationHint ?? 0;

      if (this.whisper.isConfigured()) {
        const result = await this.whisper.transcribe(tmpPath, { language: 'vi' });
        transcriptText = result.text;
        segments = result.segments;
        durationSec = result.duration || durationSec;
        this.logger.log(
          `[inline-pipeline] transcribed ${transcriptText.length} chars, ${segments.length} segments`,
        );
      } else {
        this.logger.warn('[inline-pipeline] Whisper KHÔNG cấu hình — bỏ qua transcribe');
      }

      // ── 4. Summarize ───────────────────────────────
      let summary: string | null = null;
      if (transcriptText.trim()) {
        try {
          summary = await this.summarize.summarizeTranscript(transcriptText);
        } catch (err) {
          this.logger.error(
            `[inline-pipeline] summarize fail: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      // ── 5. Detect chapters (chỉ khi có segments) ──
      let chapters: Chapter[] = [];
      if (segments.length > 0) {
        try {
          chapters = await detectChapters(segments, {
            embedFn: (text) => this.embedding.embedQuery(text),
          });
        } catch (err) {
          this.logger.error(
            `[inline-pipeline] chapters fail: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      // ── 6. Persist ─────────────────────────────────
      await this.prisma.recording.updateMany({
        where: { id: recordingId },
        data: {
          transcript: transcriptText || null,
          summary: summary || null,
          chapters:
            chapters.length > 0 ? (chapters as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
          // undefined → bỏ qua cột, giữ duration cũ (y Drizzle set undefined)
          duration_seconds: durationSec > 0 ? Math.round(durationSec) : undefined,
          status: 'PROCESSED',
          ended_at: new Date(),
        },
      });

      // ── 7. Resolve log channel + post message ──────
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
            id: randomUUID(),
            channel_id: logChannelId,
            author_id: 'system-ai-tutor',
            content,
            content_type: 'markdown',
          },
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
        this.logger.warn('[inline-pipeline] không tìm thấy log channel — bỏ qua post message');
      }

      // ── 8. Notify replay UI ────────────────────────
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

      this.logger.log(`[inline-pipeline] DONE OK ${recordingId}`);
      return {
        ok: true,
        transcriptLength: transcriptText.length,
        chapterCount: chapters.length,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[inline-pipeline] fail ${recordingId}: ${msg}`);
      await this.prisma.recording.updateMany({
        where: { id: recordingId },
        data: { status: 'FAILED' },
      });
      return { ok: false, transcriptLength: 0, chapterCount: 0, error: msg };
    } finally {
      if (tmpPath) await this.ffmpeg.safeUnlink(tmpPath);
    }
  }

  /** Download URL về tmp file — y downloadToTmp của inline-pipeline cũ. */
  private async downloadToTmp(url: string): Promise<{ path: string; sizeBytes: number }> {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Download MP4 thất bại — status ${res.status} từ ${url}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const tmpPath = path.join(tmpdir(), `cogniva-rec-${randomUUID()}.mp4`);
    await fs.writeFile(tmpPath, buf);
    return { path: tmpPath, sizeBytes: buf.byteLength };
  }
}
