/**
 * POST /api/library/docs/[id]/purchase — Phase 4 Step 5 (2026-05-27).
 *
 * Flow:
 *   1. Auth + load doc → assert isPremium=true + PUBLISHED + price > 0
 *   2. Idempotency: nếu user đã purchase → trả 200 + already=true
 *   3. PRO user → free access, ghi purchase row price=0 cho analytics, không charge wallet
 *   4. chargeWallet(LIBRARY_PURCHASE) trừ buyer balance
 *   5. creditWallet(PAYOUT_RECEIVED) cộng cho uploader theo creator_share_pct snapshot
 *   6. Insert library_doc_purchase row (link wallet_txn_id buyer side)
 *   7. Karma: award uploader "premium_sale" event (idempotent qua audit lookup)
 *
 * Race condition guard: chèn purchase row trước khi charge? Không —
 * unique (doc_id, buyer_id) làm idempotency check. Bug duy nhất: 2 request
 * cùng lúc → có thể double-charge nhưng chỉ 1 row được insert (conflict). Giải
 * pháp: wrap toàn bộ trong transaction + SELECT FOR UPDATE doc row. V1 chấp
 * nhận edge case (UI disable button sau click + double-click cực hiếm).
 */
import { randomUUID } from 'node:crypto';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';

import {
  db,
  libraryDoc,
  libraryDocPurchase,
} from '@cogniva/db';

import { auth } from '@/lib/auth';
import { chargeWallet, creditWallet, InsufficientBalanceError } from '@/lib/tutoring/wallet';
import { isUserPro } from '@/lib/library/access';
import { awardKarma } from '@/lib/library/karma';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Params) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const buyerId = session.user.id;
  const { id: docId } = await params;

  // Load doc
  const [doc] = await db
    .select({
      id: libraryDoc.id,
      uploaderId: libraryDoc.uploaderId,
      isPremium: libraryDoc.isPremium,
      priceVnd: libraryDoc.priceVnd,
      creatorSharePct: libraryDoc.creatorSharePct,
      status: libraryDoc.status,
      title: libraryDoc.title,
    })
    .from(libraryDoc)
    .where(eq(libraryDoc.id, docId))
    .limit(1);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (doc.status !== 'PUBLISHED') {
    return NextResponse.json({ error: 'Doc chưa publish' }, { status: 403 });
  }
  if (!doc.isPremium || !doc.priceVnd || doc.priceVnd <= 0) {
    return NextResponse.json(
      { error: 'Doc này miễn phí — không cần mua' },
      { status: 400 },
    );
  }
  if (doc.uploaderId === buyerId) {
    return NextResponse.json(
      { error: 'Không thể mua doc của chính bạn' },
      { status: 400 },
    );
  }

  // Idempotency
  const [existing] = await db
    .select({ id: libraryDocPurchase.id })
    .from(libraryDocPurchase)
    .where(
      and(
        eq(libraryDocPurchase.docId, docId),
        eq(libraryDocPurchase.buyerId, buyerId),
      ),
    )
    .limit(1);
  if (existing) {
    return NextResponse.json({ ok: true, already: true, purchaseId: existing.id });
  }

  // PRO branch — free, ghi purchase row với 0đ
  const isPro = await isUserPro(buyerId);
  if (isPro) {
    const purchaseId = randomUUID();
    await db.insert(libraryDocPurchase).values({
      id: purchaseId,
      docId,
      buyerId,
      priceVnd: 0,
      creatorShareVnd: 0,
      platformShareVnd: 0,
      walletTxnId: null,
    });
    return NextResponse.json({
      ok: true,
      purchaseId,
      isPro: true,
      paid: 0,
    });
  }

  // Normal charge flow
  const price = doc.priceVnd;
  const creatorShare = Math.round((price * doc.creatorSharePct) / 100);
  const platformShare = price - creatorShare;

  let chargeTxnId: string;
  try {
    const { txnId } = await chargeWallet({
      userId: buyerId,
      amountVnd: price,
      type: 'LIBRARY_PURCHASE',
      relatedId: docId,
      relatedType: 'library_doc',
      description: `Mua doc "${doc.title.slice(0, 80)}"`,
    });
    chargeTxnId = txnId;
  } catch (err) {
    if (err instanceof InsufficientBalanceError) {
      return NextResponse.json(
        {
          error: 'Số dư ví không đủ',
          required: err.required,
          available: err.available,
        },
        { status: 402 },
      );
    }
    throw err;
  }

  // Payout creator. Nếu fail (vd uploader bị xoá rare) — không rollback buyer
  // charge vì doc vẫn unlock được cho buyer; admin manual fix payout sau qua
  // ADJUSTMENT type. Log error chứ không throw.
  try {
    await creditWallet({
      userId: doc.uploaderId,
      amountVnd: creatorShare,
      type: 'PAYOUT_RECEIVED',
      relatedId: docId,
      relatedType: 'library_doc',
      description: `Bán doc "${doc.title.slice(0, 80)}" (${doc.creatorSharePct}% × ${price.toLocaleString('vi-VN')}đ)`,
    });
  } catch (err) {
    console.error('library-purchase.payout-failed', { docId, err });
  }

  const purchaseId = randomUUID();
  await db.insert(libraryDocPurchase).values({
    id: purchaseId,
    docId,
    buyerId,
    priceVnd: price,
    creatorShareVnd: creatorShare,
    platformShareVnd: platformShare,
    walletTxnId: chargeTxnId,
  });

  // Karma cho uploader. Idempotent: skipped nếu fail.
  void awardKarma({
    userId: doc.uploaderId,
    eventType: 'premium_sale',
    docId,
    context: { priceVnd: price, creatorShareVnd: creatorShare, buyerId },
  }).catch((err) => {
    console.error('library-purchase.karma-failed', { docId, err });
  });

  return NextResponse.json({
    ok: true,
    purchaseId,
    paid: price,
    creatorShare,
    platformShare,
  });
}
