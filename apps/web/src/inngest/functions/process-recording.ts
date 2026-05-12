/**
 * Inngest function `process-recording` — chạy sau khi LiveKit egress xong.
 *
 * Trigger: webhook `egress_ended` (api/webhooks/livekit) gửi event
 *          `recording/finished` → function này pickup.
 *
 * Pipeline (mỗi step retry độc lập, persistent qua Inngest):
 *   1. download-and-extract-audio : tải MP4 từ R2 → ffmpeg tách audio WAV.
 *   2. transcribe                 : Whisper API → segments + full text.
 *   3. summarize                  : Claude/OpenAI → markdown 200-300 từ.
 *   4. detect-chapters            : Voyage embed + cosine → chapter list.
 *   5. generate-flashcards        : 10 flashcard tự động từ transcript.
 *   6. persist                    : UPDATE recording row + INSERT flashcards.
 *   7. notify                     : Soketi event `recording:processed` cho room.
 *
 * Resilience:
 *   - Mỗi step.run trong Inngest tự retry exponential (3 lần default).
 *   - Whisper fail → status='FAILED' nhưng vẫn save fileUrl (user vẫn xem video).
 *   - Chapter detect fail → bỏ qua chapters, vẫn save transcript + summary.
 *   - Flashcard fail → bỏ qua (không critical, user có thể tạo manual sau).
 *
 * Cleanup: tmp files xoá ở finally block — Inngest không quản lý disk.
 */
import { eq } from 'drizzle-orm';

import { db, recording, flashcard, room } from '@cogniva/db';

import { inngest } from '../client';
import { extractAudio, getMediaDuration, safeUnlink } from '@/lib/media/ffmpeg';
import { whisperTranscribe, isWhisperConfigured } from '@/lib/media/whisper';
import { detectChapters, type Chapter } from '@/lib/media/chapters';
import {
  summarizeTranscript,
  generateFlashcardsFromTranscript,
} from '@/lib/ai/summarize';
import { embedQuery } from '@/lib/ingest/embed-query';
import { triggerEvent } from '@/lib/realtime-server';

export const processRecording = inngest.createFunction(
  {
    id: 'process-recording',
    name: 'Post-process room recording',
    retries: 3,
    // Whisper + summarize có thể chạy 10+ phút trên buổi dài
    concurrency: { limit: 2 },
  },
  { event: 'recording/finished' },
  async ({ event, step, logger }) => {
    const { recordingId, fileUrl, roomId } = event.data;

    // Track tmp files để cleanup ở cuối — closure scope cho finally
    const tmpPaths: string[] = [];

    try {
      // ── 1. Download + extract audio ─────────────────────
      const audioPath = await step.run('extract-audio', async () => {
        const out = await extractAudio(fileUrl);
        logger.info(`[process-recording] audio extracted: ${out}`);
        return out;
      });
      tmpPaths.push(audioPath);

      const duration = await step.run('probe-duration', () => getMediaDuration(audioPath));

      // Update sớm: status=PROCESSING + duration để user thấy progress
      await step.run('mark-processing', async () => {
        await db
          .update(recording)
          .set({ status: 'PROCESSING', duration: Math.round(duration) })
          .where(eq(recording.id, recordingId));
      });

      // ── 2. Transcribe (gated bằng OPENAI_API_KEY) ──────
      const transcribeResult = await step.run('transcribe', async () => {
        if (!isWhisperConfigured()) {
          logger.warn('[process-recording] Whisper chưa cấu hình — skip transcribe');
          return null;
        }
        return whisperTranscribe(audioPath, { language: 'vi' });
      });

      const transcriptText = transcribeResult?.text ?? '';
      const segments = transcribeResult?.segments ?? [];

      // ── 3. Summarize (skip nếu transcript rỗng) ────────
      const summary = await step.run('summarize', async () => {
        if (!transcriptText.trim()) return null;
        try {
          return await summarizeTranscript(transcriptText);
        } catch (err) {
          logger.error('[process-recording] summarize fail:', err);
          return null;
        }
      });

      // ── 4. Detect chapters ──────────────────────────────
      const chapters = await step.run('detect-chapters', async () => {
        if (segments.length === 0) return [] as Chapter[];
        try {
          return await detectChapters(segments, {
            embedFn: (text) => embedQuery(text),
          });
        } catch (err) {
          logger.error('[process-recording] chapter detect fail:', err);
          return [] as Chapter[];
        }
      });

      // ── 5. Generate flashcards ──────────────────────────
      const flashcardDrafts = await step.run('generate-flashcards', async () => {
        if (!transcriptText.trim()) return [];
        try {
          return await generateFlashcardsFromTranscript(transcriptText, 10);
        } catch (err) {
          logger.error('[process-recording] flashcard gen fail:', err);
          return [];
        }
      });

      // ── 6. Persist ──────────────────────────────────────
      await step.run('persist', async () => {
        // Load recording để biết owner — flashcards thuộc về owner của room
        const [rec] = await db
          .select({ id: recording.id })
          .from(recording)
          .where(eq(recording.id, recordingId))
          .limit(1);
        if (!rec) {
          logger.warn(`[process-recording] recording ${recordingId} biến mất, abort persist`);
          return;
        }

        await db
          .update(recording)
          .set({
            transcript: transcriptText || null,
            summary: summary || null,
            chapters: chapters.length > 0 ? chapters : null,
            status: 'PROCESSED',
            endedAt: new Date(),
          })
          .where(eq(recording.id, recordingId));

        // Flashcards: gắn vào userId của owner room.
        // Phase 18 sẽ share deck cho tất cả room members; v1 chỉ owner để
        // tránh duplicate cho N participants. Source tracking đặt qua tag
        // implicit "fromRecordingId:{id}" trong front (chấp nhận hack v1
        // — schema flashcard chưa có metadata jsonb, không break).
        if (flashcardDrafts.length > 0) {
          const [owner] = await db
            .select({ ownerId: room.ownerId })
            .from(room)
            .where(eq(room.id, roomId))
            .limit(1);
          if (owner?.ownerId) {
            await db.insert(flashcard).values(
              flashcardDrafts.map((c) => ({
                userId: owner.ownerId,
                front: c.front,
                back: c.back,
                cardType: 'BASIC' as const,
              })),
            );
          }
        }
      });

      // ── 7. Notify ───────────────────────────────────────
      await step.run('notify', async () => {
        await triggerEvent(`presence-room-${roomId}`, 'recording:processed', {
          recordingId,
          summary,
          chapterCount: chapters.length,
          flashcardCount: flashcardDrafts.length,
        });
      });

      return {
        recordingId,
        transcriptLength: transcriptText.length,
        chapterCount: chapters.length,
        flashcardCount: flashcardDrafts.length,
      };
    } catch (err) {
      logger.error('[process-recording] pipeline fail:', err);
      // Mark FAILED — user UI vẫn cho xem video, chỉ disable transcript tab
      await db
        .update(recording)
        .set({ status: 'FAILED' })
        .where(eq(recording.id, recordingId));
      throw err;
    } finally {
      await safeUnlink(...tmpPaths);
    }
  },
);
