/**
 * Inngest serve endpoint — đăng ký functions với Inngest CLI/Cloud.
 *
 * Dev:
 *   1. `pnpm dev:web` chạy Next.js (route này serve)
 *   2. `npx inngest-cli@latest dev -u http://localhost:3000/api/inngest`
 *      → CLI discover các function, UI tại http://localhost:8288.
 *
 * Prod:
 *   - Vercel deploy → set INNGEST_EVENT_KEY + INNGEST_SIGNING_KEY trong env.
 *   - Inngest Cloud auto sync khi deploy succeed (configured trên dashboard).
 *
 * Khi thêm function mới ở Phase 16+, chỉ cần import + thêm vào array `functions`.
 */
import { serve } from 'inngest/next';

import { inngest } from '@/inngest/client';
import { processRecording } from '@/inngest/functions/process-recording';
import { processGdprDeletion } from '@/inngest/functions/process-gdpr-deletion';
import { healthMonitor } from '@/inngest/functions/health-monitor';
import { flashcardDueReminder } from '@/inngest/functions/flashcard-due-reminder';

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    processRecording, // Phase 15 — recording post-process pipeline
    processGdprDeletion, // Stage 1 W9-10 — GDPR deletion grace processor
    healthMonitor, // Stage 1 W7-8 — periodic uptime check
    flashcardDueReminder, // Stage 2 M7 — daily flashcard reminder push
  ],
});
