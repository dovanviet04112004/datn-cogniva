/**
 * Recording endpoints cho VOICE channel của study group (Phase 20 V3).
 *
 * POST /api/channels/[id]/record  → Mod start composite recording qua LiveKit Egress.
 * GET  /api/channels/[id]/record  → List recordings của channel.
 *
 * Auth:
 *   - POST: Chỉ OWNER/ADMIN/MODERATOR mới được start (perm `voice.moderate`).
 *   - GET: bất kỳ member ACTIVE của group (perm `voice.connect`).
 *
 * Reuse pipeline Phase 15: LiveKit egress → R2 → webhook → process-recording.
 * Khác room recording: `recording.roomId = NULL`, `studyGroupChannelId = ch.id`.
 * Process-recording sẽ INSERT system message vào channel khi xong (xem
 * process-recording.ts handle channel branch).
 *
 * Consent: caller (UI) SHOULD broadcast SYSTEM message "Đang ghi âm" trước khi
 * gọi endpoint này. V3 trust client, V4 enforce qua banner middleware.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import {
  EgressClient,
  EncodedFileType,
  EncodedFileOutput,
  S3Upload,
} from 'livekit-server-sdk';

import {
  db,
  recording,
  studyGroupChannel,
  studyGroupMember,
} from '@cogniva/db';

import { auth } from '@/lib/auth';
import { can, type GroupRole } from '@/lib/group/permissions';
import { triggerEvent } from '@/lib/realtime-server';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

let _egressClient: EgressClient | null = null;
function getEgressClient(): EgressClient {
  if (_egressClient) return _egressClient;
  const url = process.env.NEXT_PUBLIC_LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!url || !apiKey || !apiSecret) {
    throw new Error('LiveKit env chưa cấu hình');
  }
  _egressClient = new EgressClient(url, apiKey, apiSecret);
  return _egressClient;
}

/** Build R2 upload — fail-fast nếu thiếu env. */
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

/** Load channel + member; trả null nếu không tồn tại / không phải member. */
async function loadContext(channelId: string, userId: string) {
  const [ch] = await db
    .select()
    .from(studyGroupChannel)
    .where(eq(studyGroupChannel.id, channelId))
    .limit(1);
  if (!ch) return null;
  const [member] = await db
    .select()
    .from(studyGroupMember)
    .where(
      and(
        eq(studyGroupMember.groupId, ch.groupId),
        eq(studyGroupMember.userId, userId),
      ),
    )
    .limit(1);
  if (!member) return null;
  return { channel: ch, member };
}

/** Start composite recording cho voice channel. */
export async function POST(_req: Request, { params }: Params) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: channelId } = await params;
  const ctx = await loadContext(channelId, session.user.id);
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { channel, member } = ctx;

  if (channel.type !== 'VOICE') {
    return NextResponse.json({ error: 'Chỉ VOICE channel mới record được' }, { status: 400 });
  }
  if (!can(member.role as GroupRole, 'voice.record')) {
    return NextResponse.json(
      { error: 'Chỉ mod/admin/owner mới được record voice channel' },
      { status: 403 },
    );
  }
  if (!channel.livekitRoomName) {
    return NextResponse.json(
      { error: 'Channel chưa có LiveKit room — yêu cầu user vào voice trước' },
      { status: 400 },
    );
  }

  // Tránh tạo 2 recording song song cho cùng channel
  const [existing] = await db
    .select({ id: recording.id })
    .from(recording)
    .where(
      and(
        eq(recording.studyGroupChannelId, channelId),
        eq(recording.status, 'RECORDING'),
      ),
    )
    .limit(1);
  if (existing) {
    return NextResponse.json(
      { error: 'Đã có recording đang chạy', recordingId: existing.id },
      { status: 409 },
    );
  }

  // Build output — fail-fast với message rõ ràng nếu R2 env thiếu
  let output: EncodedFileOutput;
  // Lưu filepath để insert vào DB.storageKey — LiveKit listEgress không
  // reliable trả filename sau vài phút (ephemeral metadata).
  const storageKey = `recordings/group/${channelId}/${Date.now()}.mp4`;
  try {
    output = new EncodedFileOutput({
      fileType: EncodedFileType.MP4,
      filepath: storageKey,
      output: { case: 's3', value: buildR2Upload() },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        error:
          'Cloud storage (R2) chưa cấu hình — cần set R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ACCOUNT_ID, R2_BUCKET_NAME trong .env.local. Chi tiết: ' +
          msg,
      },
      { status: 503 },
    );
  }

  let info;
  try {
    info = await getEgressClient().startRoomCompositeEgress(
      channel.livekitRoomName,
      output,
      'speaker',
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[channel/record] start egress fail channel=${channelId}:`, msg);
    return NextResponse.json({ error: `Egress start fail: ${msg}` }, { status: 500 });
  }

  const [rec] = await db
    .insert(recording)
    .values({
      studyGroupChannelId: channelId,
      egressId: info.egressId,
      storageKey,
      status: 'RECORDING',
      createdBy: session.user.id,
    })
    .returning();

  // Broadcast realtime để mọi participant thấy banner "Đang ghi"
  await triggerEvent(`presence-voice-${channelId}`, 'recording:started', {
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

/** List recordings của channel — mới nhất trước. */
export async function GET(_req: Request, { params }: Params) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: channelId } = await params;
  const ctx = await loadContext(channelId, session.user.id);
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const rows = await db
    .select({
      id: recording.id,
      status: recording.status,
      duration: recording.duration,
      fileUrl: recording.fileUrl,
      summary: recording.summary,
      startedAt: recording.startedAt,
      endedAt: recording.endedAt,
      createdBy: recording.createdBy,
    })
    .from(recording)
    .where(
      and(
        eq(recording.studyGroupChannelId, channelId),
        // Ẩn các row test/lỗi không có egressId (khong dùng được)
        isNotNull(recording.egressId),
      ),
    )
    .orderBy(desc(recording.startedAt))
    .limit(50);

  return NextResponse.json({ recordings: rows });
}
