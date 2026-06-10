/**
 * LivekitService — port từ apps/web/src/lib/livekit.ts (Wave 4: rooms/voice).
 *
 * Token gen (JWT join room) + RoomServiceClient cho admin API (kick, mute,
 * listParticipants). Env vars GIỮ NGUYÊN tên bản cũ — kể cả
 * NEXT_PUBLIC_LIVEKIT_URL (setup-env.mjs passthrough cùng tên từ web).
 *
 * Lazy init: env chỉ check khi gọi method, không throw lúc boot — dev env
 * thường thiếu LIVEKIT_* tạm thời, không muốn chặn các module khác.
 */
import { Injectable } from '@nestjs/common';
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

@Injectable()
export class LivekitService {
  /** RoomServiceClient cached — singleton, lazy để không throw nếu env thiếu. */
  private roomService: RoomServiceClient | null = null;

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
  async createLivekitToken(opts: {
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

  getRoomService(): RoomServiceClient {
    if (!this.roomService) {
      const { url, apiKey, apiSecret } = requireLivekitEnv();
      // SDK chấp nhận cả ws:// và wss://, tự convert sang HTTP cho REST API.
      this.roomService = new RoomServiceClient(url, apiKey, apiSecret);
    }
    return this.roomService;
  }

  /**
   * Đếm số participant đang active trong room qua LiveKit API.
   * Trả 0 nếu room chưa tồn tại (chưa ai join).
   */
  async getActiveParticipantCount(roomName: string): Promise<number> {
    try {
      const participants = await this.getRoomService().listParticipants(roomName);
      return participants.length;
    } catch (err) {
      // LiveKit trả 404 khi room chưa tồn tại — đếm là 0.
      if (err instanceof Error && /not.found/i.test(err.message)) return 0;
      throw err;
    }
  }
}
