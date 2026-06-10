/**
 * wallet — V4 T3 (2026-05-22).
 *
 * Helper atomic mutation balance + ledger row insert. Mọi balance change PHẢI
 * qua đây để đảm bảo ledger consistency.
 *
 * Pattern (transaction lock):
 *   1. SELECT FOR UPDATE row user_wallet
 *   2. Validate balance đủ
 *   3. UPDATE balance
 *   4. INSERT user_wallet_txn ledger row
 *
 * Lazy create wallet row nếu chưa có (lần đầu user mới).
 *
 * Cache: `getWallet` cache-aside (TTL 30s) cho HIỂN THỊ; mọi mutation gọi
 * `onWalletChanged` sau khi transaction commit → bust cache (read-your-own-write
 * thấy số mới ngay). Lưu ý: các mutation tự đọc bằng `SELECT FOR UPDATE` trong
 * transaction (KHÔNG đọc cache) → tiền luôn tính trên số liệu tươi, cache chỉ
 * ảnh hưởng phần hiển thị.
 *
 * Spec: docs/plans/tutoring-v4.md §6.1.
 */
import { eq, sql } from 'drizzle-orm';

import { db, userWallet, userWalletTxn } from '@cogniva/db';

import { cached } from '@/lib/cache/cache-aside';
import { ck } from '@/lib/cache/keys';
import { onWalletChanged } from '@/lib/cache/invalidate';

export type WalletTxnType =
  | 'TOPUP'
  | 'BOOKING_PAY'
  | 'PACK_PURCHASE'
  | 'REFUND'
  | 'CASHBACK'
  | 'PROMO'
  | 'PAYOUT_RECEIVED'
  | 'ADJUSTMENT'
  /** Library Phase 4 Step 5 — mua premium doc. */
  | 'LIBRARY_PURCHASE'
  /** Library Phase 4 Step 5 — subscribe PRO month. */
  | 'PRO_SUBSCRIPTION';

export class InsufficientBalanceError extends Error {
  constructor(public required: number, public available: number) {
    super(`Số dư không đủ: cần ${required}, có ${available}`);
    this.name = 'InsufficientBalanceError';
  }
}

/**
 * Lazy ensure wallet row tồn tại — gọi trước khi mọi mutation.
 * Idempotent qua ON CONFLICT DO NOTHING.
 */
export async function ensureWallet(userId: string): Promise<void> {
  await db
    .insert(userWallet)
    .values({ userId })
    .onConflictDoNothing({ target: userWallet.userId });
}

/**
 * Get current balance (lazy create nếu chưa có).
 *
 * Cache-aside TTL 30s (chỉ phục vụ hiển thị). Kiểm promo-hết-hạn chạy MỖI lần
 * (cả cache hit) — UPDATE reset chỉ khi thực sự hết hạn (hiếm) + bust cache.
 * `new Date(...)` vì cache serialize Date→string.
 */
export async function getWallet(userId: string): Promise<{
  balanceVnd: number;
  promoBalanceVnd: number;
  promoExpiresAt: Date | null;
  autoTopupThresholdVnd: number | null;
  autoTopupAmountVnd: number | null;
}> {
  await ensureWallet(userId);
  const w = await cached(ck.wallet(userId), 30, async () => {
    const [row] = await db
      .select()
      .from(userWallet)
      .where(eq(userWallet.userId, userId))
      .limit(1);
    if (!row) throw new Error('Wallet not found (sau ensureWallet?!)');
    return row;
  });

  // Promo expired → reset (kiểm mỗi lần kể cả cache hit).
  const exp = w.promoExpiresAt ? new Date(w.promoExpiresAt) : null;
  if (exp && exp < new Date() && w.promoBalanceVnd > 0) {
    await db
      .update(userWallet)
      .set({ promoBalanceVnd: 0, promoExpiresAt: null, updatedAt: new Date() })
      .where(eq(userWallet.userId, userId));
    await onWalletChanged(userId);
    return { ...w, promoBalanceVnd: 0, promoExpiresAt: null };
  }
  return { ...w, promoExpiresAt: exp };
}

/**
 * Charge wallet — trừ tiền cho booking/pack.
 *
 * Priority: promo_balance trước (consume promo credit), rồi balance chính.
 * Throw InsufficientBalanceError nếu tổng không đủ.
 *
 * Return ledger txn ID + breakdown promo/regular used.
 */
export async function chargeWallet(opts: {
  userId: string;
  amountVnd: number;
  type: Exclude<WalletTxnType, 'TOPUP' | 'REFUND' | 'CASHBACK' | 'PROMO' | 'PAYOUT_RECEIVED'>;
  relatedId?: string;
  relatedType?: string;
  description?: string;
}): Promise<{ txnId: string; promoUsed: number; regularUsed: number }> {
  const result = await db.transaction(async (tx) => {
    // SELECT FOR UPDATE
    const [w] = await tx
      .select()
      .from(userWallet)
      .where(eq(userWallet.userId, opts.userId))
      .for('update');
    if (!w) {
      throw new InsufficientBalanceError(opts.amountVnd, 0);
    }
    const total = w.balanceVnd + w.promoBalanceVnd;
    if (total < opts.amountVnd) {
      throw new InsufficientBalanceError(opts.amountVnd, total);
    }

    // Consume promo trước
    const promoUsed = Math.min(w.promoBalanceVnd, opts.amountVnd);
    const regularUsed = opts.amountVnd - promoUsed;
    const newBalance = w.balanceVnd - regularUsed;
    const newPromoBalance = w.promoBalanceVnd - promoUsed;

    await tx
      .update(userWallet)
      .set({
        balanceVnd: newBalance,
        promoBalanceVnd: newPromoBalance,
        updatedAt: new Date(),
      })
      .where(eq(userWallet.userId, opts.userId));

    const [txn] = await tx
      .insert(userWalletTxn)
      .values({
        userId: opts.userId,
        type: opts.type,
        amountVnd: -opts.amountVnd,
        balanceAfterVnd: newBalance + newPromoBalance,
        relatedId: opts.relatedId,
        relatedType: opts.relatedType,
        description: opts.description,
      })
      .returning({ id: userWalletTxn.id });

    return { txnId: txn!.id, promoUsed, regularUsed };
  });
  await onWalletChanged(opts.userId);
  return result;
}

/**
 * Top-up wallet — nạp tiền (đã xác nhận từ payment provider).
 *
 * Cashback bonus: nếu nạp ≥ 1M → tặng 5% vào promoBalance (90 ngày).
 */
export async function topupWallet(opts: {
  userId: string;
  amountVnd: number;
  relatedId?: string;
  description?: string;
}): Promise<{ txnId: string; cashback: number }> {
  await ensureWallet(opts.userId);
  const result = await db.transaction(async (tx) => {
    const [w] = await tx
      .select()
      .from(userWallet)
      .where(eq(userWallet.userId, opts.userId))
      .for('update');
    if (!w) throw new Error('Wallet missing');

    // Cashback rule — nạp ≥ 1M tặng 5% promo (90 ngày)
    const cashback =
      opts.amountVnd >= 1_000_000 ? Math.round(opts.amountVnd * 0.05) : 0;

    const newBalance = w.balanceVnd + opts.amountVnd;
    const newPromoBalance = w.promoBalanceVnd + cashback;
    const newPromoExpires = cashback
      ? new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)
      : w.promoExpiresAt;

    await tx
      .update(userWallet)
      .set({
        balanceVnd: newBalance,
        promoBalanceVnd: newPromoBalance,
        promoExpiresAt: newPromoExpires,
        updatedAt: new Date(),
      })
      .where(eq(userWallet.userId, opts.userId));

    const [txn] = await tx
      .insert(userWalletTxn)
      .values({
        userId: opts.userId,
        type: 'TOPUP',
        amountVnd: opts.amountVnd,
        balanceAfterVnd: newBalance + newPromoBalance,
        relatedId: opts.relatedId,
        relatedType: 'payment',
        description: opts.description ?? `Nạp ${opts.amountVnd.toLocaleString('vi-VN')}đ`,
      })
      .returning({ id: userWalletTxn.id });

    if (cashback > 0) {
      await tx.insert(userWalletTxn).values({
        userId: opts.userId,
        type: 'CASHBACK',
        amountVnd: cashback,
        balanceAfterVnd: newBalance + newPromoBalance,
        relatedId: txn?.id,
        relatedType: 'cashback',
        description: `Cashback 5% nạp ≥ 1M (hết hạn 90 ngày)`,
      });
    }

    return { txnId: txn!.id, cashback };
  });
  await onWalletChanged(opts.userId);
  return result;
}

/**
 * Credit wallet — payout vào wallet với ledger type tuỳ chọn.
 *
 * Khác với refundToWallet (type='REFUND' cố định), đây dùng cho:
 *   - PAYOUT_RECEIVED  : creator nhận share từ premium doc sale (Library Phase 4)
 *   - ADJUSTMENT       : admin manual credit
 *   - CASHBACK / PROMO : khi không qua applyPromoCredit (vd: tặng spontaneous)
 *
 * Lazy create wallet — KHÔNG yêu cầu user đã từng nạp tiền.
 */
export async function creditWallet(opts: {
  userId: string;
  amountVnd: number;
  type: Extract<WalletTxnType, 'PAYOUT_RECEIVED' | 'ADJUSTMENT' | 'CASHBACK'>;
  relatedId?: string;
  relatedType?: string;
  description: string;
}): Promise<{ txnId: string; newBalance: number }> {
  if (opts.amountVnd <= 0) {
    throw new Error('creditWallet: amount phải > 0');
  }
  await ensureWallet(opts.userId);
  const result = await db.transaction(async (tx) => {
    const [w] = await tx
      .select()
      .from(userWallet)
      .where(eq(userWallet.userId, opts.userId))
      .for('update');
    if (!w) throw new Error('Wallet missing sau ensureWallet');

    const newBalance = w.balanceVnd + opts.amountVnd;
    await tx
      .update(userWallet)
      .set({ balanceVnd: newBalance, updatedAt: new Date() })
      .where(eq(userWallet.userId, opts.userId));

    const [txn] = await tx
      .insert(userWalletTxn)
      .values({
        userId: opts.userId,
        type: opts.type,
        amountVnd: opts.amountVnd,
        balanceAfterVnd: newBalance + w.promoBalanceVnd,
        relatedId: opts.relatedId,
        relatedType: opts.relatedType,
        description: opts.description,
      })
      .returning({ id: userWalletTxn.id });

    return { txnId: txn!.id, newBalance };
  });
  await onWalletChanged(opts.userId);
  return result;
}

/**
 * Refund vào wallet — auto-refund khi cancel ≥ 24h.
 * KHÔNG call provider (đã trừ wallet rồi); chỉ refund instant.
 */
export async function refundToWallet(opts: {
  userId: string;
  amountVnd: number;
  relatedId?: string;
  relatedType?: string;
  description: string;
}): Promise<{ txnId: string }> {
  await ensureWallet(opts.userId);
  const result = await db.transaction(async (tx) => {
    const [w] = await tx
      .select()
      .from(userWallet)
      .where(eq(userWallet.userId, opts.userId))
      .for('update');
    if (!w) throw new Error('Wallet missing');

    const newBalance = w.balanceVnd + opts.amountVnd;
    await tx
      .update(userWallet)
      .set({ balanceVnd: newBalance, updatedAt: new Date() })
      .where(eq(userWallet.userId, opts.userId));

    const [txn] = await tx
      .insert(userWalletTxn)
      .values({
        userId: opts.userId,
        type: 'REFUND',
        amountVnd: opts.amountVnd,
        balanceAfterVnd: newBalance + w.promoBalanceVnd,
        relatedId: opts.relatedId,
        relatedType: opts.relatedType,
        description: opts.description,
      })
      .returning({ id: userWalletTxn.id });

    return { txnId: txn!.id };
  });
  await onWalletChanged(opts.userId);
  return result;
}

/**
 * Apply promo credit — admin push hoặc redeem code.
 */
export async function applyPromoCredit(opts: {
  userId: string;
  amountVnd: number;
  expiresAt: Date;
  relatedId?: string;
  description: string;
}): Promise<{ txnId: string }> {
  await ensureWallet(opts.userId);
  const result = await db.transaction(async (tx) => {
    const [w] = await tx
      .select()
      .from(userWallet)
      .where(eq(userWallet.userId, opts.userId))
      .for('update');
    if (!w) throw new Error('Wallet missing');

    const newPromo = w.promoBalanceVnd + opts.amountVnd;
    // Lấy expiry xa hơn giữa hiện tại và mới
    const newExpires =
      w.promoExpiresAt && w.promoExpiresAt > opts.expiresAt
        ? w.promoExpiresAt
        : opts.expiresAt;

    await tx
      .update(userWallet)
      .set({
        promoBalanceVnd: newPromo,
        promoExpiresAt: newExpires,
        updatedAt: new Date(),
      })
      .where(eq(userWallet.userId, opts.userId));

    const [txn] = await tx
      .insert(userWalletTxn)
      .values({
        userId: opts.userId,
        type: 'PROMO',
        amountVnd: opts.amountVnd,
        balanceAfterVnd: w.balanceVnd + newPromo,
        relatedId: opts.relatedId,
        relatedType: 'promo',
        description: opts.description,
      })
      .returning({ id: userWalletTxn.id });

    return { txnId: txn!.id };
  });
  await onWalletChanged(opts.userId);
  return result;
}

// Unused but keep for future BullMQ cron
void sql;
