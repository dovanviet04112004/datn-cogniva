/**
 * Recording endpoints — start + list cho 1 room.
 *
 * POST /api/rooms/[id]/record  → Mod start composite recording qua LiveKit Egress.
 * GET  /api/rooms/[id]/record  → List recordings của room (cho dropdown lịch sử).
 *
 * Auth:
 *   - Chỉ OWNER hoặc MODERATOR mới được start (LiveKit token đã có roomRecord
 *     grant cho mod, nhưng web API check thêm tránh leak qua direct curl).
 *   - GET chỉ cần là member ACTIVE.
 *
 * Egress flow (LiveKit):
 *   1. POST /room-composite trả `egressId` (chưa upload, mới start).
 *   2. Egress service render composite layout 'speaker' → MP4 → S3/R2.
 *   3. Khi xong, LiveKit gửi webhook `egress_ended` → Inngest event
 *      `recording/finished` → process-recording.ts pipeline chạy.
 *
 * R2 bucket cần config trong egress.yaml (xem infrastructure/livekit-egress/).
 * Web API chỉ ký request + lưu egressId, KHÔNG đụng vào S3 credentials.
 *
 * Privacy/consent: caller (UI) phải broadcast SYSTEM message "Buổi học đang
 * được ghi" trước khi gọi endpoint này — Phase 15 trust client, audit sau.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import {
  EgressClient,
  EncodedFileType,
  EncodedFileOutput,
  S3Upload,
} from 'livekit-server-sdk';

import { db, recording, roomMember, room } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { triggerEvent } from '@/lib/realtime-server';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

/** Lazy init EgressClient — tránh throw lúc import nếu env thiếu. */
let _egressClient: EgressClient | null = null;
function getEgressClient(): EgressClient {
  if (_egressClient) return _egressClient;
  const url = process.env.NEXT_PUBLIC_LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!url || !apiKey || !apiSecret) {
    throw new Error('LiveKit env chưa cấu hình');
  }
  // SDK chấp nhận ws:// và convert sang HTTPS cho REST API
  _egressClient = new EgressClient(url, apiKey, apiSecret);
  return _egressClient;
}

/**
 * Build S3Upload nếu R2 đầy đủ env; throw nếu thiếu để mod biết phải set.
 * filepath không cần truyền vào SDK — đã set trong EncodedFileOutput.filepath
 * ở caller. Hàm này chỉ build credentials + endpoint cho R2.
 */
function buildR2Upload(): S3Upload {
  const accessKey = process.env.R2_ACCESS_KEY_ID;
  const secret = process.env.R2_SECRET_ACCESS_KEY;
  const accountId = process.env.R2_ACCOUNT_ID;
  const bucket = process.env.R2_BUCKET_NAME ?? 'cogniva-recordings';
  if (!accessKey || !secret || !accountId) {
    throw new Error(
      'R2 env chưa đủ — cần R2_ACCESS_KEY_ID + R2_SECRET_ACCESS_KEY + R2_ACCOUNT_ID',
    );
  }
  return new S3Upload({
    accessKey,
    secret,
    region: 'auto',
    bucket,
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    forcePathStyle: true,
  });
}

/** Check user là mod/owner của room. */
async function assertMod(roomId: string, userId: string) {
  const [m] = await db
    .select({ role: roomMember.role, status: roomMember.status })
    .from(roomMember)
    .where(and(eq(roomMember.roomId, roomId), eq(roomMember.userId, userId)))
    .limit(1);
  return m?.status === 'ACTIVE' && (m.role === 'OWNER' || m.role === 'MODERATOR');
}

/** Start composite recording. */
export async function POST(_req: Request, { params }: Params) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: roomId } = await params;

  if (!(await assertMod(roomId, session.user.id))) {
    return NextResponse.json(
      { error: 'Chỉ mod/owner mới được record buổi học' },
      { status: 403 },
    );
  }

  // Check feature toggle + room status ACTIVE
  const [roomRow] = await db
    .select({ status: room.status, features: room.features, name: room.name })
    .from(room)
    .where(eq(room.id, roomId))
    .limit(1);
  if (!roomRow) {
    return NextResponse.json({ error: 'Room not found' }, { status: 404 });
  }
  const features = (roomRow.features as Record<string, boolean>) ?? {};
  if (features.recording === false) {
    return NextResponse.json(
      { error: 'Recording đã bị tắt trong phòng này (settings)' },
      { status: 403 },
    );
  }
  if (roomRow.status !== 'ACTIVE') {
    return NextResponse.json(
      { error: `Không thể record khi room đang ${roomRow.status}` },
      { status: 400 },
    );
  }

  // Check chưa có recording nào đang RECORDING — tránh nhân đôi
  const [existing] = await db
    .select({ id: recording.id })
    .from(recording)
    .where(and(eq(recording.roomId, roomId), eq(recording.status, 'RECORDING')))
    .limit(1);
  if (existing) {
    return NextResponse.json(
      { error: 'Đã có recording đang chạy', recordingId: existing.id },
      { status: 409 },
    );
  }

  // S3 filepath — ts để dễ sort + tránh collision khi mod restart record
  const filepath = `recordings/${roomId}/${Date.now()}.mp4`;
  const output = new EncodedFileOutput({
    fileType: EncodedFileType.MP4,
    filepath,
    output: { case: 's3', value: buildR2Upload() },
  });

  let info;
  try {
    // SDK 2.x signature: startRoomCompositeEgress(roomName, output, layout?, ...)
    // — KHÔNG dùng { file, layout } literal vì TS bị mất overload.
    info = await getEgressClient().startRoomCompositeEgress(
      roomId,
      output,
      'speaker', // 'grid' | 'speaker' | 'single-speaker'
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[record] start egress fail room=${roomId}:`, msg);
    return NextResponse.json(
      { error: `Egress start fail: ${msg}` },
      { status: 500 },
    );
  }

  // Insert recording row — egressId là khoá để webhook update sau
  const [rec] = await db
    .insert(recording)
    .values({
      roomId,
      egressId: info.egressId,
      status: 'RECORDING',
    })
    .returning();

  // Broadcast SYSTEM message vào chat — mọi participant đều thấy
  // (consent banner: privacy notice phase 15)
  await triggerEvent(`presence-room-${roomId}`, 'recording:started', {
    recordingId: rec!.id,
    egressId: info.egressId,
    byUserId: session.user.id,
    byUserName: session.user.name,
  });

  return NextResponse.json({
    ok: true,
    recordingId: rec!.id,
    egressId: info.egressId,
  });
}

/** List recordings của room — sort mới nhất trước. */
export async function GET(_req: Request, { params }: Params) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: roomId } = await params;

  // Member ACTIVE only
  const [m] = await db
    .select()
    .from(roomMember)
    .where(
      and(
        eq(roomMember.roomId, roomId),
        eq(roomMember.userId, session.user.id),
        eq(roomMember.status, 'ACTIVE'),
      ),
    )
    .limit(1);
  if (!m) return NextResponse.json({ error: 'Not a member' }, { status: 403 });

  const rows = await db
    .select({
      id: recording.id,
      status: recording.status,
      duration: recording.duration,
      fileUrl: recording.fileUrl,
      summary: recording.summary,
      startedAt: recording.startedAt,
      endedAt: recording.endedAt,
    })
    .from(recording)
    .where(eq(recording.roomId, roomId))
    .orderBy(desc(recording.startedAt))
    .limit(50);

  return NextResponse.json({ recordings: rows });
}
