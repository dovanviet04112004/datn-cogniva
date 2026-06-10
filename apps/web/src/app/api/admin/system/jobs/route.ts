/**
 * GET /api/admin/system/jobs — trạng thái background jobs (BullMQ).
 *
 * Trả live job counts của từng queue (active/waiting/delayed/completed/failed) +
 * danh sách cron repeatable. Fail-open nếu Redis down (trả counts rỗng + flag).
 *
 * (Bull Board UI có thể thêm sau như 1 service riêng; bản này đủ cho admin console.)
 */
import { NextResponse } from 'next/server';

import { isGuardResponse, requireAdminRole } from '@/lib/admin/guard';
import { getRecordingQueue, getDocumentQueue, getCronQueue } from '@/queue/queues';
import { CRON_JOBS } from '@/queue/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireAdminRole();
  } catch (err) {
    if (isGuardResponse(err)) return err;
    throw err;
  }

  let queues: Array<{ name: string; counts: Record<string, number> }> = [];
  let redisOk = true;
  try {
    const defs = [
      { name: 'recording', q: getRecordingQueue() },
      { name: 'document', q: getDocumentQueue() },
      { name: 'cron', q: getCronQueue() },
    ];
    queues = await Promise.all(
      defs.map(async ({ name, q }) => ({
        name,
        counts: await q.getJobCounts('active', 'waiting', 'delayed', 'completed', 'failed'),
      })),
    );
  } catch {
    redisOk = false;
  }

  return NextResponse.json({
    queues,
    crons: CRON_JOBS,
    redisConfigured: !!process.env.REDIS_URL,
    redisOk,
  });
}
