/**
 * BullMQ job `process-recording` — chạy bởi worker sau khi LiveKit egress xong.
 *
 * Trigger: webhook `egress_ended` (api/webhooks/livekit) → `recordingQueue.add('process', data)`.
 *
 * Pipeline:
 *   1. download MP4 từ R2 → ffmpeg tách audio
 *   2. Whisper transcribe  → persist transcript NGAY (checkpoint)
 *   3. summarize → 4. detect chapters → 5. generate flashcards
 *   6. persist (status=PROCESSED + summary + chapters + flashcards)
 *   7. notify realtime
 *
 * Resilience + idempotency (whole-job retry của BullMQ, attempts=2):
 *   - **Early-return nếu status='PROCESSED'**: job đã xong ở lần trước → KHÔNG chạy lại
 *     (tránh tốn Whisper + double-insert flashcard). Realtime notify best-effort, client
 *     vẫn refetch/`/sync` được.
 *   - **Checkpoint transcript**: persist transcript+duration ngay sau Whisper (status vẫn
 *     PROCESSING). Retry sau đó reuse transcript → bỏ qua download+Whisper (bước đắt nhất
 *     10-30'). Summary/flashcards tính lại (rẻ); chapters cần segments (mất khi resume) →
 *     giữ chapters đã persist (thường rỗng) — chấp nhận, chapters không critical.
 *   - Whisper fail → status='FAILED' nhưng vẫn giữ video (user xem được).
 *   - Chapter/flashcard fail → bỏ qua (không critical).
 *
 * Cleanup tmp files ở finally.
 */
import { and, asc, eq } from 'drizzle-orm';

import {
  db,
  recording,
  flashcard,
  room,
  studyGroup,
  studyGroupChannel,
  studyGroupMessage,
} from '@cogniva/db';

import { extractAudio, getMediaDuration, safeUnlink } from '@/lib/media/ffmpeg';
import { whisperTranscribe, isWhisperConfigured } from '@/lib/media/whisper';
import { detectChapters, type Chapter } from '@/lib/media/chapters';
import {
  summarizeTranscript,
  generateFlashcardsFromTranscript,
} from '@/lib/ai/summarize';
import { embedQuery } from '@/lib/ingest/embed-query';
import { onDashboardChanged, onRoomRecordingsChanged } from '@/lib/cache/invalidate';
import { triggerEvent } from '@/lib/realtime-server';
import { logger } from '@/lib/observability/logger';
import type { RecordingJob } from '@/queue/jobs';

export async function processRecording(data: RecordingJob) {
  const { recordingId, fileUrl, roomId, channelId } = data;

  // Checkpoint: đọc state hiện tại của recording.
  const [existing] = await db
    .select({
      status: recording.status,
      transcript: recording.transcript,
      chapters: recording.chapters,
      duration: recording.duration,
    })
    .from(recording)
    .where(eq(recording.id, recordingId))
    .limit(1);

  if (!existing) {
    logger.warn('[process-recording] recording không tồn tại, skip', { recordingId });
    return { recordingId, skipped: 'not-found' };
  }
  // Đã xử lý xong ở lần chạy trước (retry sau khi persist) → KHÔNG làm lại.
  if (existing.status === 'PROCESSED') {
    logger.info('[process-recording] đã PROCESSED, skip (idempotent)', { recordingId });
    return { recordingId, skipped: 'already-processed' };
  }

  const tmpPaths: string[] = [];
  // True sau khi đã commit PROCESSED (+ flashcards) → catch KHÔNG revert về FAILED,
  // và whole-job retry sẽ early-return trên PROCESSED (không làm lại/không dup).
  let persisted = false;

  try {
    let duration = existing.duration ?? 0;
    let transcriptText = existing.transcript ?? '';
    let summary: string | null = null;
    let chapters: Chapter[] = Array.isArray(existing.chapters)
      ? (existing.chapters as Chapter[])
      : [];

    // ── 1-2. Download + extract audio + Whisper — CHỈ khi chưa có transcript ──
    if (!transcriptText.trim()) {
      const audioPath = await extractAudio(fileUrl);
      logger.info(`[process-recording] audio extracted: ${audioPath}`);
      tmpPaths.push(audioPath);

      duration = await getMediaDuration(audioPath);

      // Update sớm: status=PROCESSING + duration để user thấy progress
      await db
        .update(recording)
        .set({ status: 'PROCESSING', duration: Math.round(duration) })
        .where(eq(recording.id, recordingId));

      // Transcribe (gated bằng OPENAI_API_KEY)
      const transcribeResult = isWhisperConfigured()
        ? await whisperTranscribe(audioPath, { language: 'vi' })
        : null;
      if (!transcribeResult) {
        logger.warn('[process-recording] Whisper chưa cấu hình — skip transcribe');
      }
      transcriptText = transcribeResult?.text ?? '';
      const segments = transcribeResult?.segments ?? [];

      // Checkpoint: persist transcript NGAY sau Whisper → retry sau bỏ qua bước đắt này.
      if (transcriptText.trim()) {
        await db
          .update(recording)
          .set({ transcript: transcriptText })
          .where(eq(recording.id, recordingId));
      }

      // Detect chapters cần segments (chỉ có ở lần Whisper này).
      if (segments.length > 0) {
        try {
          chapters = await detectChapters(segments, { embedFn: (text) => embedQuery(text) });
        } catch (err) {
          logger.error('process-recording.chapter-fail', { error: String(err) });
          chapters = [];
        }
      }
    } else {
      logger.info('[process-recording] reuse transcript đã persist (skip download+Whisper)', {
        recordingId,
      });
    }

    // ── 3. Summarize (skip nếu transcript rỗng) ──
    if (transcriptText.trim()) {
      try {
        summary = await summarizeTranscript(transcriptText);
      } catch (err) {
        logger.error('process-recording.summarize-fail', { error: String(err) });
        summary = null;
      }
    }

    // ── 5. Generate flashcards ──
    let flashcardDrafts: Array<{ front: string; back: string }> = [];
    if (transcriptText.trim()) {
      try {
        flashcardDrafts = await generateFlashcardsFromTranscript(transcriptText, 10);
      } catch (err) {
        logger.error('process-recording.flashcard-fail', { error: String(err) });
        flashcardDrafts = [];
      }
    }

    // ── 6. Persist — ATOMIC: status=PROCESSED ⟺ flashcards (1 transaction) ──
    // Kết hợp early-return trên PROCESSED ở đầu job → whole-job retry (attempts=2)
    // KHÔNG double-insert flashcard (flashcard không có unique key để dedup).
    const [rec] = await db
      .select({ id: recording.id })
      .from(recording)
      .where(eq(recording.id, recordingId))
      .limit(1);
    if (rec) {
      // Owner để gắn flashcard (chỉ room recording — channel nhiều owner, skip).
      let flashcardOwnerId: string | null = null;
      if (flashcardDrafts.length > 0 && roomId) {
        const [owner] = await db
          .select({ ownerId: room.ownerId })
          .from(room)
          .where(eq(room.id, roomId))
          .limit(1);
        flashcardOwnerId = owner?.ownerId ?? null;
      }
      const flashcardValues = flashcardOwnerId
        ? flashcardDrafts.map((c) => ({
            userId: flashcardOwnerId as string,
            front: c.front,
            back: c.back,
            cardType: 'BASIC' as const,
          }))
        : [];

      await db.transaction(async (tx) => {
        await tx
          .update(recording)
          .set({
            transcript: transcriptText || null,
            summary: summary || null,
            chapters: chapters.length > 0 ? chapters : null,
            status: 'PROCESSED',
            endedAt: new Date(),
          })
          .where(eq(recording.id, recordingId));
        if (flashcardValues.length > 0) {
          await tx.insert(flashcard).values(flashcardValues);
        }
      });
      persisted = true;

      // Cache invalidation (fail-open) — ngoài transaction.
      if (roomId) await onRoomRecordingsChanged(roomId);
      if (flashcardOwnerId) await onDashboardChanged(flashcardOwnerId);
    } else {
      logger.warn(`[process-recording] recording ${recordingId} biến mất, abort persist`);
    }

    // ── 6b. Voice channel: post system message vào log channel ──
    let logChannelId: string | null = null;
    let voiceChannelName = '';
    if (channelId) {
      const [voiceCh] = await db
        .select({ groupId: studyGroupChannel.groupId, name: studyGroupChannel.name })
        .from(studyGroupChannel)
        .where(eq(studyGroupChannel.id, channelId))
        .limit(1);
      if (voiceCh) {
        voiceChannelName = voiceCh.name;

        // 1. Try group.recordingLogChannelId
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

        // 2. Fallback: TEXT channel đầu tiên theo position
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
        const [msg] = await db
          .insert(studyGroupMessage)
          .values({
            channelId: logChannelId,
            authorId: 'system-ai-tutor',
            content,
            contentType: 'markdown',
          })
          .returning();
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
        logger.warn('[process-recording] không tìm thấy log channel — bỏ qua post message', {
          channelId,
        });
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
      const [ch] = await db
        .select({ groupId: studyGroupChannel.groupId })
        .from(studyGroupChannel)
        .where(eq(studyGroupChannel.id, channelId))
        .limit(1);
      if (ch) {
        await triggerEvent(`presence-group-${ch.groupId}`, 'message:new-in-channel', {
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
    logger.error('process-recording.pipeline-fail', {
      error: err instanceof Error ? err.message : String(err),
    });
    // Mark FAILED — user UI vẫn cho xem video, chỉ disable transcript tab. KHÔNG revert
    // nếu đã PROCESSED (lỗi ở bước sau persist) — để retry early-return, tránh dup.
    if (!persisted) {
      await db.update(recording).set({ status: 'FAILED' }).where(eq(recording.id, recordingId));
    }
    throw err;
  } finally {
    if (tmpPaths.length > 0) await safeUnlink(...tmpPaths);
  }
}
