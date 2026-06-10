/**
 * POST /api/channels/[id]/record/[recordingId]/sync
 *
 * Force-poll LiveKit egress status — workaround khi webhook chưa cấu hình
 * (LiveKit Cloud không gọi được localhost, cần ngrok).
 *
 * Flow:
 *   1. Verify recording thuộc channel + user là mod.
 *   2. Query LiveKit `listEgress({ egressId })` → lấy state hiện tại.
 *   3. Nếu egress đã COMPLETE → extract fileUrl/size/duration → update DB
 *      → chạy recording pipeline y như webhook.
 *   4. Trả về status mới cho client refresh.
 *
 * Idempotent: gọi nhiều lần OK; nếu đã PROCESSED/FAILED → skip update.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { EgressClient, EgressStatus } from 'livekit-server-sdk';

import {
  db,
  recording,
  studyGroupChannel,
  studyGroupMember,
} from '@cogniva/db';

import { auth } from '@/lib/auth';
import { can, type GroupRole } from '@/lib/group/permissions';
import { triggerEvent } from '@/lib/realtime-server';
import { buildR2PublicUrl, resolveEgressFileUrl } from '@/lib/r2-url';
import { runRecordingPipeline } from '@/lib/recording/inline-pipeline';

export const runtime = 'nodejs';
// Pipeline có thể chạy 1-3 phút (Whisper transcribe). Cần extend timeout.
export const maxDuration = 300;

type Params = { params: Promise<{ id: string; recordingId: string }> };

let _egressClient: EgressClient | null = null;
function getEgressClient(): EgressClient {
  if (_egressClient) return _egressClient;
  const url = process.env.NEXT_PUBLIC_LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!url || !apiKey || !apiSecret) throw new Error('LiveKit env missing');
  _egressClient = new EgressClient(url, apiKey, apiSecret);
  return _egressClient;
}

export async function POST(req: Request, { params }: Params) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: channelId, recordingId } = await params;
  const url = new URL(req.url);
  // ?force=1 → re-process recording đã FAILED hoặc PROCESSED (mod retry)
  const force = url.searchParams.get('force') === '1';

  // Verify mod
  const [ch] = await db
    .select({ groupId: studyGroupChannel.groupId })
    .from(studyGroupChannel)
    .where(eq(studyGroupChannel.id, channelId))
    .limit(1);
  if (!ch) return NextResponse.json({ error: 'Channel not found' }, { status: 404 });

  const [member] = await db
    .select({ role: studyGroupMember.role })
    .from(studyGroupMember)
    .where(
      and(
        eq(studyGroupMember.groupId, ch.groupId),
        eq(studyGroupMember.userId, session.user.id),
      ),
    )
    .limit(1);
  if (!member || !can(member.role as GroupRole, 'voice.record')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const [rec] = await db
    .select()
    .from(recording)
    .where(
      and(eq(recording.id, recordingId), eq(recording.studyGroupChannelId, channelId)),
    )
    .limit(1);
  if (!rec) return NextResponse.json({ error: 'Recording not found' }, { status: 404 });
  if (!rec.egressId) {
    return NextResponse.json(
      { error: 'Recording không có egressId — không sync được' },
      { status: 400 },
    );
  }
  if ((rec.status === 'PROCESSED' || rec.status === 'FAILED') && !force) {
    return NextResponse.json({ status: rec.status, alreadyDone: true });
  }

  // Query LiveKit
  let egressList;
  try {
    egressList = await getEgressClient().listEgress({ egressId: rec.egressId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[sync] listEgress fail:', msg);
    return NextResponse.json({ error: 'LiveKit query fail: ' + msg }, { status: 502 });
  }
  const info = egressList?.[0];
  if (!info) {
    return NextResponse.json(
      { error: 'Egress không tồn tại trên LiveKit (có thể đã quá 24h)' },
      { status: 404 },
    );
  }

  // Mapping LiveKit EgressStatus → DB status
  // EGRESS_STARTING/ACTIVE/ENDING = RECORDING; COMPLETE = upload xong; FAILED/ABORTED = fail
  const lkStatus = info.status;
  let newDbStatus: 'RECORDING' | 'PROCESSING' | 'PROCESSED' | 'FAILED' = rec.status as
    | 'RECORDING'
    | 'PROCESSING'
    | 'PROCESSED'
    | 'FAILED';
  let fileUrl: string | null = rec.fileUrl;
  let fileSize: number | null = rec.fileSize;
  let duration: number | null = rec.duration;

  if (lkStatus === EgressStatus.EGRESS_COMPLETE) {
    const fileResult = info.fileResults?.[0];
    // Ưu tiên storageKey lưu sẵn lúc start record (reliable nhất).
    // Fallback resolveEgressFileUrl(LiveKit info) cho recording cũ chưa có storageKey.
    fileUrl = rec.storageKey
      ? buildR2PublicUrl(rec.storageKey)
      : resolveEgressFileUrl({
          filename: fileResult?.filename,
          location: fileResult?.location,
        });
    fileSize = fileResult?.size ? Number(fileResult.size) : null;
    duration =
      info.endedAt && info.startedAt
        ? Math.round((Number(info.endedAt) - Number(info.startedAt)) / 1_000_000_000)
        : null;
    newDbStatus = fileUrl ? 'PROCESSING' : 'FAILED';
  } else if (
    lkStatus === EgressStatus.EGRESS_FAILED ||
    lkStatus === EgressStatus.EGRESS_ABORTED
  ) {
    newDbStatus = 'FAILED';
  } else if (
    lkStatus === EgressStatus.EGRESS_ACTIVE ||
    lkStatus === EgressStatus.EGRESS_STARTING
  ) {
    // Egress vẫn đang chạy — không thay đổi DB, chỉ báo cho client biết để retry
    return NextResponse.json({
      status: rec.status,
      egressStatus: lkStatus,
      message: 'Egress vẫn đang chạy trên LiveKit — thử lại sau vài giây',
    });
  } else if (lkStatus === EgressStatus.EGRESS_ENDING) {
    return NextResponse.json({
      status: rec.status,
      egressStatus: lkStatus,
      message: 'Egress đang flush file lên R2 — thử lại sau vài giây',
    });
  }

  // Update DB
  await db
    .update(recording)
    .set({
      status: newDbStatus,
      fileUrl,
      fileSize,
      duration,
      endedAt: rec.endedAt ?? new Date(),
    })
    .where(eq(recording.id, recordingId));

  // Nếu vừa chuyển sang PROCESSING + có fileUrl → chạy inline pipeline ngay.
  // Pipeline await sync trong request này → user thấy progress real-time qua
  // toast khi page poll. Trả response sau khi pipeline xong.
  if (newDbStatus === 'PROCESSING' && fileUrl) {
    await triggerEvent(`presence-voice-${channelId}`, 'recording:ended', {
      recordingId: rec.id,
      fileUrl,
    });
    const pipelineResult = await runRecordingPipeline({
      recordingId: rec.id,
      fileUrl,
      channelId,
      durationHint: duration ?? undefined,
    });
    return NextResponse.json({
      status: pipelineResult.ok ? 'PROCESSED' : 'FAILED',
      egressStatus: lkStatus,
      fileUrl,
      duration,
      transcriptLength: pipelineResult.transcriptLength,
      chapterCount: pipelineResult.chapterCount,
      ...(pipelineResult.error ? { pipelineError: pipelineResult.error } : {}),
    });
  }

  return NextResponse.json({
    status: newDbStatus,
    egressStatus: lkStatus,
    fileUrl,
    duration,
  });
}
