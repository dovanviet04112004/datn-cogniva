import { Injectable } from '@nestjs/common';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';

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
  private roomService: RoomServiceClient | null = null;

  async createLivekitToken(opts: {
    identity: string;
    roomName: string;
    name?: string;
    isMod?: boolean;
    ttl?: string;
    metadata?: Record<string, unknown>;
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
      this.roomService = new RoomServiceClient(url, apiKey, apiSecret);
    }
    return this.roomService;
  }

  async getActiveParticipantCount(roomName: string): Promise<number> {
    try {
      const participants = await this.getRoomService().listParticipants(roomName);
      return participants.length;
    } catch (err) {
      if (err instanceof Error && /not.found/i.test(err.message)) return 0;
      throw err;
    }
  }
}
