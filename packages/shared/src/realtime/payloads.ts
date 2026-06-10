/**
 * Zod schema cho payload event realtime — type-safe dùng chung web + mobile.
 *
 * RN-safe: chỉ `zod`, không native dep. Đây là TYPING/validation TÙY CHỌN — wrapper
 * `useRealtimeEvent<T>` vẫn generic; component có thể dùng các type suy ra dưới đây
 * (`z.infer`) để khỏi gõ tay shape. KHÔNG bắt buộc phủ 100% event — chỉ những payload
 * hay tái dùng + nhóm presence (gateway + client phụ thuộc shape này về mặt cấu trúc).
 */
import { z } from 'zod';

// ── Presence (gateway ⇄ client — shape này là HỢP ĐỒNG, không chỉ gợi ý) ──
/** `presence:state` — snapshot toàn bộ user đang online trong channel, gửi cho socket vừa subscribe. */
export const zPresenceState = z.object({
  channel: z.string(),
  userIds: z.array(z.string()),
});
/** `presence:join` / `presence:leave` — 1 user vào/rời (đã ref-count multi-tab ở gateway). */
export const zPresenceMember = z.object({
  channel: z.string(),
  userId: z.string(),
});
export type PresenceState = z.infer<typeof zPresenceState>;
export type PresenceMember = z.infer<typeof zPresenceMember>;

// ── Chat / message ──────────────────────────────────────
/** `user:typing` — indicator đang gõ trong channel. */
export const zTyping = z.object({
  userId: z.string(),
  name: z.string(),
  image: z.string().nullish(),
  expiresAt: z.number(),
});
export type TypingPayload = z.infer<typeof zTyping>;

/** `status:change` — đổi trạng thái self-declared (online/idle/dnd/invisible) + text/emoji. */
export const zStatusChange = z.object({
  userId: z.string(),
  status: z.enum(['online', 'idle', 'dnd', 'offline', 'invisible']),
  statusText: z.string().nullish(),
  statusEmoji: z.string().nullish(),
});
export type StatusChangePayload = z.infer<typeof zStatusChange>;

// ── Voice ────────────────────────────────────────────────
/** Cờ trạng thái thiết bị của participant voice. */
export const zVoiceState = z.object({
  selfMuted: z.boolean(),
  serverMuted: z.boolean(),
  camera: z.boolean(),
  screenShare: z.boolean(),
});
/** `voice:join` — participant vào voice channel (kèm trạng thái thiết bị). */
export const zVoiceJoin = zVoiceState.extend({
  userId: z.string(),
  name: z.string().nullish(),
  image: z.string().nullish(),
});
/** `voice:state-changed` — đổi mic/cam/screen. */
export const zVoiceStateChanged = zVoiceState.extend({ userId: z.string() });
export type VoiceJoinPayload = z.infer<typeof zVoiceJoin>;
export type VoiceStateChangedPayload = z.infer<typeof zVoiceStateChanged>;
