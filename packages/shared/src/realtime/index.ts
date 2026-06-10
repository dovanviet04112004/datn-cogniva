/**
 * @cogniva/shared/realtime — hợp đồng realtime dùng chung web + mobile + gateway.
 *
 * RN-safe tuyệt đối: chỉ `zod`, KHÔNG redis/ioredis/db/socket.io/browser API.
 *   - `ch` / `parseChannel` / `isPresenceChannel` : quy ước tên channel + authorize
 *   - `EV` / `RealtimeEvent`                      : tên event chuẩn hoá
 *   - zod payload + type suy ra                   : type-safe shape (tùy chọn)
 *
 * Package `@cogniva/shared` để `"type":"module"` (ESM) — gateway apps/realtime chạy qua
 * tsx import named export từ đây; nếu shared bị coi là CJS thì named re-export không resolve
 * được qua ESM boundary ("does not provide an export named ..."). Re-export tường minh
 * (không `export *`) cho rõ ràng + robust.
 */
export { ch, parseChannel, isPresenceChannel } from './channels';
export type { ChannelKind } from './channels';

export { EV } from './events';
export type { RealtimeEvent } from './events';

export {
  zPresenceState,
  zPresenceMember,
  zTyping,
  zStatusChange,
  zVoiceState,
  zVoiceJoin,
  zVoiceStateChanged,
} from './payloads';
export type {
  PresenceState,
  PresenceMember,
  TypingPayload,
  StatusChangePayload,
  VoiceJoinPayload,
  VoiceStateChangedPayload,
} from './payloads';
