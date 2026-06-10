/**
 * LibraryWalletService — atomic balance mutation + ledger insert, port SUBSET
 * từ apps/web/src/lib/tutoring/wallet.ts (chỉ 4 hàm library money routes dùng:
 * ensureWallet/chargeWallet/creditWallet/refundToWallet — tutoring wave sẽ port
 * bản đầy đủ riêng).
 *
 * Pattern transaction lock giữ nguyên: SELECT FOR UPDATE → validate → UPDATE
 * balance → INSERT user_wallet_txn. Promo balance consume TRƯỚC balance chính.
 * Mọi mutation xong gọi onWalletChanged (cache hiển thị); số tiền luôn tính
 * trên SELECT FOR UPDATE trong txn, KHÔNG đọc cache.
 */
import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { onWalletChanged } from '@cogniva/server-core/cache/invalidate';

import { PrismaService } from '../../infra/database/prisma.service';

export class InsufficientBalanceError extends Error {
  constructor(
    public required: number,
    public available: number,
  ) {
    super(`Số dư không đủ: cần ${required}, có ${available}`);
    this.name = 'InsufficientBalanceError';
  }
}

type WalletRow = { user_id: string; balance_vnd: number; promo_balance_vnd: number };

@Injectable()
export class LibraryWalletService {
  constructor(private readonly prisma: PrismaService) {}

  /** Lazy ensure wallet row tồn tại — idempotent (ON CONFLICT DO NOTHING). */
  async ensureWallet(userId: string): Promise<void> {
    await this.prisma.user_wallet.createMany({
      data: [{ user_id: userId }],
      skipDuplicates: true,
    });
  }

  /**
   * Charge wallet — trừ tiền (promo balance trước, rồi balance chính).
   * Throw InsufficientBalanceError nếu tổng không đủ. KHÔNG lazy-create wallet
   * (như bản cũ: chưa từng nạp → coi như available=0).
   */
  async chargeWallet(opts: {
    userId: string;
    amountVnd: number;
    type: 'LIBRARY_PURCHASE' | 'PRO_SUBSCRIPTION';
    relatedId?: string;
    relatedType?: string;
    description?: string;
  }): Promise<{ txnId: string; promoUsed: number; regularUsed: number }> {
    const result = await this.prisma.$transaction(async (tx) => {
      const [w] = await tx.$queryRaw<WalletRow[]>(Prisma.sql`
        SELECT user_id, balance_vnd, promo_balance_vnd
        FROM user_wallet WHERE user_id = ${opts.userId} FOR UPDATE
      `);
      if (!w) {
        throw new InsufficientBalanceError(opts.amountVnd, 0);
      }
      const total = w.balance_vnd + w.promo_balance_vnd;
      if (total < opts.amountVnd) {
        throw new InsufficientBalanceError(opts.amountVnd, total);
      }

      const promoUsed = Math.min(w.promo_balance_vnd, opts.amountVnd);
      const regularUsed = opts.amountVnd - promoUsed;
      const newBalance = w.balance_vnd - regularUsed;
      const newPromoBalance = w.promo_balance_vnd - promoUsed;

      await tx.user_wallet.update({
        where: { user_id: opts.userId },
        data: {
          balance_vnd: newBalance,
          promo_balance_vnd: newPromoBalance,
          updated_at: new Date(),
        },
      });

      const txn = await tx.user_wallet_txn.create({
        data: {
          id: randomUUID(),
          user_id: opts.userId,
          type: opts.type,
          amount_vnd: -opts.amountVnd,
          balance_after_vnd: newBalance + newPromoBalance,
          related_id: opts.relatedId,
          related_type: opts.relatedType,
          description: opts.description,
        },
        select: { id: true },
      });

      return { txnId: txn.id, promoUsed, regularUsed };
    });
    await onWalletChanged(opts.userId);
    return result;
  }

  /**
   * Credit wallet — payout creator nhận share premium doc sale. Lazy create
   * wallet (KHÔNG yêu cầu uploader đã từng nạp tiền).
   */
  async creditWallet(opts: {
    userId: string;
    amountVnd: number;
    type: 'PAYOUT_RECEIVED';
    relatedId?: string;
    relatedType?: string;
    description: string;
  }): Promise<{ txnId: string; newBalance: number }> {
    if (opts.amountVnd <= 0) {
      throw new Error('creditWallet: amount phải > 0');
    }
    await this.ensureWallet(opts.userId);
    const result = await this.prisma.$transaction(async (tx) => {
      const [w] = await tx.$queryRaw<WalletRow[]>(Prisma.sql`
        SELECT user_id, balance_vnd, promo_balance_vnd
        FROM user_wallet WHERE user_id = ${opts.userId} FOR UPDATE
      `);
      if (!w) throw new Error('Wallet missing sau ensureWallet');

      const newBalance = w.balance_vnd + opts.amountVnd;
      await tx.user_wallet.update({
        where: { user_id: opts.userId },
        data: { balance_vnd: newBalance, updated_at: new Date() },
      });

      const txn = await tx.user_wallet_txn.create({
        data: {
          id: randomUUID(),
          user_id: opts.userId,
          type: opts.type,
          amount_vnd: opts.amountVnd,
          balance_after_vnd: newBalance + w.promo_balance_vnd,
          related_id: opts.relatedId,
          related_type: opts.relatedType,
          description: opts.description,
        },
        select: { id: true },
      });

      return { txnId: txn.id, newBalance };
    });
    await onWalletChanged(opts.userId);
    return result;
  }

  /** Refund vào wallet (type='REFUND' cố định) — cancel PRO prorate. */
  async refundToWallet(opts: {
    userId: string;
    amountVnd: number;
    relatedId?: string;
    relatedType?: string;
    description: string;
  }): Promise<{ txnId: string }> {
    await this.ensureWallet(opts.userId);
    const result = await this.prisma.$transaction(async (tx) => {
      const [w] = await tx.$queryRaw<WalletRow[]>(Prisma.sql`
        SELECT user_id, balance_vnd, promo_balance_vnd
        FROM user_wallet WHERE user_id = ${opts.userId} FOR UPDATE
      `);
      if (!w) throw new Error('Wallet missing');

      const newBalance = w.balance_vnd + opts.amountVnd;
      await tx.user_wallet.update({
        where: { user_id: opts.userId },
        data: { balance_vnd: newBalance, updated_at: new Date() },
      });

      const txn = await tx.user_wallet_txn.create({
        data: {
          id: randomUUID(),
          user_id: opts.userId,
          type: 'REFUND',
          amount_vnd: opts.amountVnd,
          balance_after_vnd: newBalance + w.promo_balance_vnd,
          related_id: opts.relatedId,
          related_type: opts.relatedType,
          description: opts.description,
        },
        select: { id: true },
      });

      return { txnId: txn.id };
    });
    await onWalletChanged(opts.userId);
    return result;
  }
}
