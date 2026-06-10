/**
 * GET /api/leaderboard — top users by XP.
 *
 * Chỉ liệt kê user có isPublic = true. Trả top N (mặc định 20).
 * Không cần auth — leaderboard hiển thị cho mọi visitor.
 *
 * Logic query tách sang `lib/leaderboard/get-leaderboard.ts` để trang SSR
 * /leaderboard dùng chung (1 nguồn duy nhất). Route giữ contract cho mobile.
 */
import { NextResponse } from 'next/server';

import { getLeaderboard } from '@/lib/leaderboard/get-leaderboard';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 20), 100);
  const leaderboard = await getLeaderboard(limit);
  return NextResponse.json({ leaderboard });
}
