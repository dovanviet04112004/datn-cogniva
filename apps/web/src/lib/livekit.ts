/**
 * LiveKit server helpers — phục vụ token gen + Room admin API.
 *
 * Vì sao file này:
 *   - Phase 13 sẽ có `POST /api/rooms/token` cần ký JWT cho client join room.
 *   - Phase 14 sẽ có mod action (kick, mute) cần RoomServiceClient.
 *   - Phase 12 chỉ wire infrastructure → file này chuẩn bị sẵn, route handler
 *     sẽ import khi build Phase 13.
 *
 * Lazy init: env vars chỉ check khi gọi hàm, không throw lúc module load.
 * Lý do: dev env thường thiếu LIVEKIT_* tạm thời, không muốn break Next.js
 * routing cho các trang khác (vd `/documents`).
 */
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';

/** Đọc env LiveKit + throw rõ ràng nếu thiếu. */
function requireLivekitEnv() {
  const url = process.env.NEXT_PUBLIC_LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!url || !apiKey || !apiSecret) {
    throw new Error(
      'LiveKit env chưa cấu hình. Cần NEXT_PUBLIC_LIVEKIT_URL + ' +
        'LIVEKIT_API_KEY + LIVEKIT_API_SECRET. Xem infrastructure/README.md.',
    );
  }
  return { url, apiKey, apiSecret };
}

/**
 * Ký JWT cho user join room.
 *
 * @param identity  - User ID duy nhất (LiveKit dùng làm participant.identity).
 * @param roomName  - Tên room (= rooms.id trong DB convention).
 * @param name      - Display name hiển thị cho participant khác (optional).
 * @param isMod     - Cấp `roomAdmin` + `roomRecord` cho OWNER/MODERATOR.
 * @param ttl       - JWT TTL, default '2h' (đủ cho 1 buổi học).
 * @param metadata  - Custom metadata (avatar URL, role…) gắn vào participant.
 */
export async function createLivekitToken(opts: {
  identity: string;
  roomName: string;
  name?: string;
  isMod?: boolean;
  ttl?: string;
  metadata?: Record<string, unknown>;
  /**
   * Cho phép user publish audio/video. Default true.
   * Set false cho Stage channel audience — họ chỉ subscribe, không phát.
   */
  canPublish?: boolean;
}): Promise<string> {
  const { apiKey, apiSecret } = requireLivekitEnv();

  const at = new AccessToken(apiKey, apiSecret, {
    identity: opts.identity,
    name: opts.name,
    ttl: opts.ttl ?? '2h',
    metadata: opts.metadata ? JSON.stringify(opts.metadata) : undefined,
  });

  at.addGrant({
    room: opts.roomName,
    roomJoin: true,
    canPublish: opts.canPublish ?? true,
    canSubscribe: true,
    canPublishData: true,
    roomAdmin: opts.isMod ?? false,
    roomRecord: opts.isMod ?? false,
  });

  return at.toJwt();
}

/**
 * RoomServiceClient cached — singleton cho admin API (kick, mute, listRooms).
 * Lazy để không throw lúc import nếu env thiếu.
 */
let _roomService: RoomServiceClient | null = null;

export function getRoomService(): RoomServiceClient {
  if (!_roomService) {
    const { url, apiKey, apiSecret } = requireLivekitEnv();
    // SDK chấp nhận cả ws:// và wss://, tự convert sang HTTP cho REST API.
    _roomService = new RoomServiceClient(url, apiKey, apiSecret);
  }
  return _roomService;
}

/**
 * Đếm số participant đang active trong room qua LiveKit API.
 * Trả 0 nếu room chưa tồn tại (chưa ai join).
 */
export async function getActiveParticipantCount(roomName: string): Promise<number> {
  try {
    const participants = await getRoomService().listParticipants(roomName);
    return participants.length;
  } catch (err) {
    // LiveKit trả 404 khi room chưa tồn tại — đếm là 0.
    if (err instanceof Error && /not.found/i.test(err.message)) return 0;
    throw err;
  }
}
