/**
 * GET /api/wallet — V4 T3 (2026-05-22).
 *
 * Trả balance + 10 txn gần nhất + auto-topup config.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';

import { db, userWalletTxn } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { getWallet } from '@/lib/tutoring/wallet';

export const runtime = 'nodejs';

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const wallet = await getWallet(session.user.id);
  const recent = await db
    .select()
    .from(userWalletTxn)
    .where(eq(userWalletTxn.userId, session.user.id))
    .orderBy(desc(userWalletTxn.createdAt))
    .limit(10);

  return NextResponse.json({
    wallet,
    recentTxn: recent,
  });
}
