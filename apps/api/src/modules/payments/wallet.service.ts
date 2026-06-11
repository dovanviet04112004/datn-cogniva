import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { cached } from '@cogniva/server-core/cache/cache-aside';
import { ck } from '@cogniva/server-core/cache/keys';
import { onWalletChanged } from '@cogniva/server-core/cache/invalidate';

import { PrismaService } from '../../infra/database/prisma.service';

export type WalletTxnType =
  | 'TOPUP'
  | 'BOOKING_PAY'
  | 'PACK_PURCHASE'
  | 'REFUND'
  | 'CASHBACK'
  | 'PROMO'
  | 'PAYOUT_RECEIVED'
  | 'ADJUSTMENT'
  | 'LIBRARY_PURCHASE'
  | 'PRO_SUBSCRIPTION';

export class InsufficientBalanceError extends Error {
  constructor(
    public required: number,
    public available: number,
  ) {
    super(`Số dư không đủ: cần ${required}, có ${available}`);
    this.name = 'InsufficientBalanceError';
  }
}

type WalletRow = {
  user_id: string;
  balance_vnd: number;
  promo_balance_vnd: number;
  promo_expires_at: Date | null;
};

export type WalletView = {
  userId: string;
  balanceVnd: number;
  promoBalanceVnd: number;
  promoExpiresAt: Date | null;
  autoTopupThresholdVnd: number | null;
  autoTopupAmountVnd: number | null;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class WalletService {
  constructor(private readonly prisma: PrismaService) {}

  async ensureWallet(userId: string): Promise<void> {
    await this.prisma.user_wallet.createMany({
      data: [{ user_id: userId }],
      skipDuplicates: true,
    });
  }

  async getWallet(userId: string): Promise<WalletView> {
    await this.ensureWallet(userId);
    const w = await cached(ck.wallet(userId), 30, async () => {
      const row = await this.prisma.user_wallet.findUnique({ where: { user_id: userId } });
      if (!row) throw new Error('Wallet not found (sau ensureWallet?!)');
      return {
        userId: row.user_id,
        balanceVnd: row.balance_vnd,
        promoBalanceVnd: row.promo_balance_vnd,
        promoExpiresAt: row.promo_expires_at,
        autoTopupThresholdVnd: row.auto_topup_threshold_vnd,
        autoTopupAmountVnd: row.auto_topup_amount_vnd,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      } satisfies WalletView;
    });

    const exp = w.promoExpiresAt ? new Date(w.promoExpiresAt) : null;
    if (exp && exp < new Date() && w.promoBalanceVnd > 0) {
      await this.prisma.user_wallet.update({
        where: { user_id: userId },
        data: { promo_balance_vnd: 0, promo_expires_at: null, updated_at: new Date() },
      });
      await onWalletChanged(userId);
      return { ...w, promoBalanceVnd: 0, promoExpiresAt: null };
    }
    return { ...w, promoExpiresAt: exp };
  }

  async chargeWallet(opts: {
    userId: string;
    amountVnd: number;
    type: Exclude<WalletTxnType, 'TOPUP' | 'REFUND' | 'CASHBACK' | 'PROMO' | 'PAYOUT_RECEIVED'>;
    relatedId?: string;
    relatedType?: string;
    description?: string;
  }): Promise<{ txnId: string; promoUsed: number; regularUsed: number }> {
    const result = await this.prisma.$transaction(async (tx) => {
      const w = await this.lockWallet(tx, opts.userId);
      if (!w) throw new InsufficientBalanceError(opts.amountVnd, 0);
      const total = w.balance_vnd + w.promo_balance_vnd;
      if (total < opts.amountVnd) throw new InsufficientBalanceError(opts.amountVnd, total);

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
      const txnId = await this.insertLedger(tx, {
        userId: opts.userId,
        type: opts.type,
        amountVnd: -opts.amountVnd,
        balanceAfterVnd: newBalance + newPromoBalance,
        relatedId: opts.relatedId,
        relatedType: opts.relatedType,
        description: opts.description,
      });
      return { txnId, promoUsed, regularUsed };
    });
    await onWalletChanged(opts.userId);
    return result;
  }

  async topupWallet(opts: {
    userId: string;
    amountVnd: number;
    relatedId?: string;
    description?: string;
  }): Promise<{ txnId: string; cashback: number }> {
    await this.ensureWallet(opts.userId);
    const result = await this.prisma.$transaction(async (tx) => {
      const w = await this.lockWallet(tx, opts.userId);
      if (!w) throw new Error('Wallet missing');

      const cashback = opts.amountVnd >= 1_000_000 ? Math.round(opts.amountVnd * 0.05) : 0;
      const newBalance = w.balance_vnd + opts.amountVnd;
      const newPromoBalance = w.promo_balance_vnd + cashback;

      await tx.user_wallet.update({
        where: { user_id: opts.userId },
        data: {
          balance_vnd: newBalance,
          promo_balance_vnd: newPromoBalance,
          ...(cashback
            ? { promo_expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000) }
            : {}),
          updated_at: new Date(),
        },
      });
      const txnId = await this.insertLedger(tx, {
        userId: opts.userId,
        type: 'TOPUP',
        amountVnd: opts.amountVnd,
        balanceAfterVnd: newBalance + newPromoBalance,
        relatedId: opts.relatedId,
        relatedType: 'payment',
        description: opts.description ?? `Nạp ${opts.amountVnd.toLocaleString('vi-VN')}đ`,
      });
      if (cashback > 0) {
        await this.insertLedger(tx, {
          userId: opts.userId,
          type: 'CASHBACK',
          amountVnd: cashback,
          balanceAfterVnd: newBalance + newPromoBalance,
          relatedId: txnId,
          relatedType: 'cashback',
          description: `Cashback 5% nạp ≥ 1M (hết hạn 90 ngày)`,
        });
      }
      return { txnId, cashback };
    });
    await onWalletChanged(opts.userId);
    return result;
  }

  async creditWallet(opts: {
    userId: string;
    amountVnd: number;
    type: Extract<WalletTxnType, 'PAYOUT_RECEIVED' | 'ADJUSTMENT' | 'CASHBACK'>;
    relatedId?: string;
    relatedType?: string;
    description: string;
  }): Promise<{ txnId: string; newBalance: number }> {
    if (opts.amountVnd <= 0) throw new Error('creditWallet: amount phải > 0');
    await this.ensureWallet(opts.userId);
    const result = await this.prisma.$transaction(async (tx) => {
      const w = await this.lockWallet(tx, opts.userId);
      if (!w) throw new Error('Wallet missing sau ensureWallet');

      const newBalance = w.balance_vnd + opts.amountVnd;
      await tx.user_wallet.update({
        where: { user_id: opts.userId },
        data: { balance_vnd: newBalance, updated_at: new Date() },
      });
      const txnId = await this.insertLedger(tx, {
        userId: opts.userId,
        type: opts.type,
        amountVnd: opts.amountVnd,
        balanceAfterVnd: newBalance + w.promo_balance_vnd,
        relatedId: opts.relatedId,
        relatedType: opts.relatedType,
        description: opts.description,
      });
      return { txnId, newBalance };
    });
    await onWalletChanged(opts.userId);
    return result;
  }

  async refundToWallet(opts: {
    userId: string;
    amountVnd: number;
    relatedId?: string;
    relatedType?: string;
    description: string;
  }): Promise<{ txnId: string }> {
    await this.ensureWallet(opts.userId);
    const result = await this.prisma.$transaction(async (tx) => {
      const w = await this.lockWallet(tx, opts.userId);
      if (!w) throw new Error('Wallet missing');

      const newBalance = w.balance_vnd + opts.amountVnd;
      await tx.user_wallet.update({
        where: { user_id: opts.userId },
        data: { balance_vnd: newBalance, updated_at: new Date() },
      });
      const txnId = await this.insertLedger(tx, {
        userId: opts.userId,
        type: 'REFUND',
        amountVnd: opts.amountVnd,
        balanceAfterVnd: newBalance + w.promo_balance_vnd,
        relatedId: opts.relatedId,
        relatedType: opts.relatedType,
        description: opts.description,
      });
      return { txnId };
    });
    await onWalletChanged(opts.userId);
    return result;
  }

  async applyPromoCredit(opts: {
    userId: string;
    amountVnd: number;
    expiresAt: Date;
    relatedId?: string;
    description: string;
  }): Promise<{ txnId: string }> {
    await this.ensureWallet(opts.userId);
    const result = await this.prisma.$transaction(async (tx) => {
      const w = await this.lockWallet(tx, opts.userId);
      if (!w) throw new Error('Wallet missing');

      const newPromo = w.promo_balance_vnd + opts.amountVnd;
      const newExpires =
        w.promo_expires_at && w.promo_expires_at > opts.expiresAt
          ? w.promo_expires_at
          : opts.expiresAt;

      await tx.user_wallet.update({
        where: { user_id: opts.userId },
        data: {
          promo_balance_vnd: newPromo,
          promo_expires_at: newExpires,
          updated_at: new Date(),
        },
      });
      const txnId = await this.insertLedger(tx, {
        userId: opts.userId,
        type: 'PROMO',
        amountVnd: opts.amountVnd,
        balanceAfterVnd: w.balance_vnd + newPromo,
        relatedId: opts.relatedId,
        relatedType: 'promo',
        description: opts.description,
      });
      return { txnId };
    });
    await onWalletChanged(opts.userId);
    return result;
  }

  private async lockWallet(tx: Prisma.TransactionClient, userId: string) {
    const [w] = await tx.$queryRaw<WalletRow[]>(Prisma.sql`
      SELECT user_id, balance_vnd, promo_balance_vnd, promo_expires_at
      FROM user_wallet WHERE user_id = ${userId} FOR UPDATE
    `);
    return w ?? null;
  }

  private async insertLedger(
    tx: Prisma.TransactionClient,
    row: {
      userId: string;
      type: WalletTxnType;
      amountVnd: number;
      balanceAfterVnd: number;
      relatedId?: string;
      relatedType?: string;
      description?: string;
    },
  ): Promise<string> {
    const txn = await tx.user_wallet_txn.create({
      data: {
        id: randomUUID(),
        user_id: row.userId,
        type: row.type,
        amount_vnd: row.amountVnd,
        balance_after_vnd: row.balanceAfterVnd,
        related_id: row.relatedId,
        related_type: row.relatedType,
        description: row.description,
      },
      select: { id: true },
    });
    return txn.id;
  }
}
