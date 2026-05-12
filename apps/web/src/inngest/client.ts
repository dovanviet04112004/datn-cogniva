/**
 * Inngest client — singleton cho mọi function trigger event.
 *
 * Dev: chạy `npx inngest-cli@latest dev` (Inngest Dev Server) → tự discover
 * functions tại http://localhost:3000/api/inngest và replay events trên UI.
 * Khi không có dev server, Next.js route handler vẫn nhận POST đăng ký, chỉ
 * không có UI/retry — production trỏ INNGEST_EVENT_KEY/INNGEST_SIGNING_KEY
 * tới Inngest Cloud.
 *
 * Phase 15 events:
 *   - `recording/finished` : LiveKit egress xong → trigger process-recording
 *                            (extract audio → Whisper → summary → chapters)
 *
 * Future:
 *   - `ingest/document.uploaded` : pipeline chunking + embedding (Phase 1 — hiện
 *     pipeline.ts xử lý inline, sẽ migrate sang Inngest khi scale)
 *   - `exam/published` : Phase 16 notification
 */
import { Inngest } from 'inngest';

export const inngest = new Inngest({
  id: 'cogniva',
  /**
   * Event key — cần để send events từ server. Dev có thể bỏ trống (Inngest CLI
   * tự generate); prod set từ Inngest Cloud dashboard.
   */
  eventKey: process.env.INNGEST_EVENT_KEY,
});

/**
 * Type helper cho event payload — đăng ký schema để autocomplete + type-check.
 * Khi gửi: `inngest.send({ name: 'recording/finished', data: {...} })`.
 */
export type InngestEvents = {
  'recording/finished': {
    data: {
      recordingId: string;
      egressId: string;
      /** R2 key của MP4 đã upload (`recordings/{roomId}/{ts}.mp4`). */
      r2Key: string;
      /** URL có thể truy cập (presigned hoặc public) — process function dùng để download. */
      fileUrl: string;
      roomId: string;
      duration?: number;
      fileSize?: number;
    };
  };
};
