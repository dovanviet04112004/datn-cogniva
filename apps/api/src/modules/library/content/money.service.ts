import { randomUUID } from 'node:crypto';
import { HttpException, Injectable } from '@nestjs/common';
import { z } from 'zod';

import { PrismaService } from '../../../infra/database/prisma.service';
import { InsufficientBalanceError, WalletService } from '../../payments/wallet.service';
import { KarmaService } from './karma.service';
import { LibraryAccessService } from './access.service';

const MONTHLY_PRICE_VND = 199_000;
const MONTH_DAYS = 30;

const SUBSCRIBE_BODY = z.object({
  months: z.number().int().min(1).max(12).default(1),
});

@Injectable()
export class LibraryMoneyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: LibraryAccessService,
    private readonly wallet: WalletService,
    private readonly karma: KarmaService,
  ) {}

  async proStatus(userId: string) {
    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { plan: true, pro_until_at: true },
    });
    return { plan: row?.plan ?? null, proUntilAt: row?.pro_until_at ?? null };
  }

  async purchase(buyerId: string, docId: string) {
    const doc = await this.prisma.library_doc.findUnique({
      where: { id: docId },
      select: {
        id: true,
        uploader_id: true,
        is_premium: true,
        price_vnd: true,
        creator_share_pct: true,
        status: true,
        title: true,
      },
    });
    if (!doc) throw new HttpException({ error: 'Not found' }, 404);

    if (doc.status !== 'PUBLISHED') {
      throw new HttpException({ error: 'Doc chưa publish' }, 403);
    }
    if (!doc.is_premium || !doc.price_vnd || doc.price_vnd <= 0) {
      throw new HttpException({ error: 'Doc này miễn phí — không cần mua' }, 400);
    }
    if (doc.uploader_id === buyerId) {
      throw new HttpException({ error: 'Không thể mua doc của chính bạn' }, 400);
    }

    const existing = await this.prisma.library_doc_purchase.findFirst({
      where: { doc_id: docId, buyer_id: buyerId },
      select: { id: true },
    });
    if (existing) {
      return { ok: true, already: true, purchaseId: existing.id };
    }

    const isPro = await this.access.isUserPro(buyerId);
    if (isPro) {
      const purchaseId = randomUUID();
      await this.prisma.library_doc_purchase.create({
        data: {
          id: purchaseId,
          doc_id: docId,
          buyer_id: buyerId,
          price_vnd: 0,
          creator_share_vnd: 0,
          platform_share_vnd: 0,
          wallet_txn_id: null,
        },
      });
      return { ok: true, purchaseId, isPro: true, paid: 0 };
    }

    const price = doc.price_vnd;
    const sharePct = doc.creator_share_pct ?? 80;
    const creatorShare = Math.round((price * sharePct) / 100);
    const platformShare = price - creatorShare;

    let chargeTxnId: string;
    try {
      const { txnId } = await this.wallet.chargeWallet({
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
        throw new HttpException(
          { error: 'Số dư ví không đủ', required: err.required, available: err.available },
          402,
        );
      }
      throw err;
    }

    try {
      await this.wallet.creditWallet({
        userId: doc.uploader_id,
        amountVnd: creatorShare,
        type: 'PAYOUT_RECEIVED',
        relatedId: docId,
        relatedType: 'library_doc',
        description: `Bán doc "${doc.title.slice(0, 80)}" (${sharePct}% × ${price.toLocaleString('vi-VN')}đ)`,
      });
    } catch (err) {
      console.error('library-purchase.payout-failed', { docId, err });
    }

    const purchaseId = randomUUID();
    await this.prisma.library_doc_purchase.create({
      data: {
        id: purchaseId,
        doc_id: docId,
        buyer_id: buyerId,
        price_vnd: price,
        creator_share_vnd: creatorShare,
        platform_share_vnd: platformShare,
        wallet_txn_id: chargeTxnId,
      },
    });

    void this.karma
      .awardKarma({
        userId: doc.uploader_id,
        eventType: 'premium_sale',
        docId,
        context: { priceVnd: price, creatorShareVnd: creatorShare, buyerId },
      })
      .catch((err) => {
        console.error('library-purchase.karma-failed', { docId, err });
      });

    return { ok: true, purchaseId, paid: price, creatorShare, platformShare };
  }

  async subscribePro(userId: string, raw: unknown) {
    const parsed = SUBSCRIBE_BODY.safeParse(raw ?? {});
    if (!parsed.success) {
      throw new HttpException({ error: 'Invalid body', details: parsed.error.flatten() }, 400);
    }
    const months = parsed.data.months;
    const totalPrice = MONTHLY_PRICE_VND * months;

    let txnId: string;
    try {
      const result = await this.wallet.chargeWallet({
        userId,
        amountVnd: totalPrice,
        type: 'PRO_SUBSCRIPTION',
        relatedType: 'library_pro',
        description: `Subscribe Cogniva PRO ${months} tháng`,
      });
      txnId = result.txnId;
    } catch (err) {
      if (err instanceof InsufficientBalanceError) {
        throw new HttpException(
          { error: 'Số dư ví không đủ', required: err.required, available: err.available },
          402,
        );
      }
      throw err;
    }

    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { pro_until_at: true },
    });
    const now = new Date();
    const cur = row?.pro_until_at ?? null;
    const base = cur && cur > now ? cur : now;
    const newProUntil = new Date(base.getTime() + months * MONTH_DAYS * 86400_000);

    await this.prisma.user.update({
      where: { id: userId },
      data: { plan: 'PRO', pro_until_at: newProUntil, updated_at: new Date() },
    });

    return {
      ok: true,
      paid: totalPrice,
      months,
      proUntilAt: newProUntil.toISOString(),
      walletTxnId: txnId,
    };
  }

  async cancelPro(userId: string) {
    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { plan: true, pro_until_at: true },
    });
    if (!row) throw new HttpException({ error: 'User not found' }, 404);

    const now = new Date();
    const isActive = row.plan === 'PRO' && row.pro_until_at && row.pro_until_at > now;

    if (!isActive) {
      if (row.plan === 'PRO') {
        await this.prisma.user.update({
          where: { id: userId },
          data: { plan: 'FREE', updated_at: new Date() },
        });
      }
      return { ok: true, refunded: 0, reason: 'pro_inactive' };
    }

    const remainingMs = row.pro_until_at!.getTime() - now.getTime();
    const remainingDays = remainingMs / 86400_000;
    const rawRefund = Math.round((remainingDays / MONTH_DAYS) * MONTHLY_PRICE_VND);

    const lookbackCutoff = new Date(now.getTime() - 90 * 86400_000);
    const recentCharges = await this.prisma.user_wallet_txn.findMany({
      where: {
        user_id: userId,
        type: 'PRO_SUBSCRIPTION',
        created_at: { gte: lookbackCutoff },
      },
      orderBy: { created_at: 'desc' },
      select: { amount_vnd: true },
    });
    const totalCharged = recentCharges.reduce((acc, r) => acc + Math.abs(r.amount_vnd), 0);
    const refundVnd = Math.max(0, Math.min(rawRefund, totalCharged));

    let refundTxnId: string | null = null;
    if (refundVnd > 0) {
      const { txnId } = await this.wallet.refundToWallet({
        userId,
        amountVnd: refundVnd,
        relatedType: 'library_pro',
        description: `Hoàn ${remainingDays.toFixed(1)} ngày PRO chưa dùng`,
      });
      refundTxnId = txnId;
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { plan: 'FREE', pro_until_at: now, updated_at: new Date() },
    });

    return {
      ok: true,
      refunded: refundVnd,
      remainingDays: Number(remainingDays.toFixed(2)),
      refundTxnId,
    };
  }
}
