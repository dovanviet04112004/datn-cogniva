/**
 * TutoringMarketService — port từ apps/web/src/app/api/tutoring/
 * {classes,packs/[id]/purchase,promo/redeem,favorites}/route.ts.
 *
 * TIỀN đi qua WalletService (PaymentsModule) — purchase/redeem giữ NGUYÊN
 * thứ tự "charge/credit trước, ghi row sau" của bản cũ (không gộp transaction
 * — đổi atomicity là đổi hành vi, để cutover sau).
 */
import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../../infra/database/prisma.service';
import {
  InsufficientBalanceError,
  WalletService,
} from '../../payments/wallet.service';
import type { PackPurchaseInput, PromoRedeemInput } from './market.dto';

const PACK_EXPIRES_DAYS = 90;
const WALLET_CREDIT_EXPIRY_DAYS = 60;

@Injectable()
export class TutoringMarketService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
  ) {}

  /** GET /tutoring/classes — browse class OPEN, startDate >= from (date-only). */
  async listClasses(query: { subject?: string; level?: string; from?: string }) {
    const from = query.from ? new Date(query.from) : new Date();

    const where: Prisma.tutoring_classWhereInput = {
      status: 'OPEN',
      // Route cũ so cột date với string YYYY-MM-DD — tương đương date UTC-midnight.
      start_date: { gte: new Date(from.toISOString().slice(0, 10)) },
    };
    if (query.subject) where.subject_slug = query.subject;
    if (query.level) where.level = query.level;

    const rows = await this.prisma.tutoring_class.findMany({
      where,
      orderBy: { start_date: 'asc' },
      take: 50,
      select: {
        id: true,
        tutor_id: true,
        title: true,
        description: true,
        subject_slug: true,
        level: true,
        max_students: true,
        enrolled_count: true,
        rate_per_student_vnd: true,
        duration_min: true,
        total_sessions: true,
        schedule_type: true,
        schedule_slots: true,
        start_date: true,
        status: true,
        tutor_profile: {
          select: {
            headline: true,
            avatar_url: true,
            user: { select: { name: true } },
          },
        },
      },
    });

    return {
      classes: rows.map((c) => ({
        id: c.id,
        tutorId: c.tutor_id,
        title: c.title,
        description: c.description,
        subjectSlug: c.subject_slug,
        level: c.level,
        maxStudents: c.max_students,
        enrolledCount: c.enrolled_count,
        ratePerStudentVnd: c.rate_per_student_vnd,
        durationMin: c.duration_min,
        totalSessions: c.total_sessions,
        scheduleType: c.schedule_type,
        scheduleSlots: c.schedule_slots,
        // Drizzle date() trả string YYYY-MM-DD — Prisma trả Date, cắt lại cho khớp.
        startDate: c.start_date.toISOString().slice(0, 10),
        status: c.status,
        tutorHeadline: c.tutor_profile.headline,
        tutorAvatarUrl: c.tutor_profile.avatar_url,
        tutorName: c.tutor_profile.user.name,
      })),
    };
  }

  /** POST /tutoring/packs/:id/purchase — charge ví kỳ đầu rồi tạo purchase row. */
  async purchasePack(userId: string, packId: string, body: PackPurchaseInput) {
    const pack = await this.prisma.tutoring_pack.findUnique({ where: { id: packId } });
    if (!pack || pack.status !== 'ACTIVE') {
      throw new NotFoundException({ error: 'Pack không khả dụng' });
    }

    const totalPeriods = body.installmentPeriods;
    const periodAmount = totalPeriods
      ? Math.ceil(pack.total_vnd / totalPeriods)
      : pack.total_vnd;

    let chargeResult: Awaited<ReturnType<WalletService['chargeWallet']>>;
    try {
      chargeResult = await this.wallet.chargeWallet({
        userId,
        amountVnd: periodAmount,
        type: 'PACK_PURCHASE',
        relatedType: 'pack',
        relatedId: packId,
        description: totalPeriods
          ? `Pack ${pack.session_count} buổi — kỳ 1/${totalPeriods}`
          : `Pack ${pack.session_count} buổi`,
      });
    } catch (err) {
      if (err instanceof InsufficientBalanceError) {
        throw new HttpException(
          {
            error: 'Số dư wallet không đủ — nạp thêm để mua pack',
            required: err.required,
            available: err.available,
          },
          402,
        );
      }
      throw err;
    }

    const purchase = await this.prisma.tutoring_pack_purchase.create({
      data: {
        id: randomUUID(),
        pack_id: pack.id,
        student_id: userId,
        total_vnd: pack.total_vnd,
        remaining_sessions: pack.session_count,
        installment_total_periods: totalPeriods,
        installment_paid_periods: totalPeriods ? 1 : 0,
        recurring_schedule: body.recurringSchedule,
        status: 'ACTIVE',
        expires_at: new Date(Date.now() + PACK_EXPIRES_DAYS * 24 * 60 * 60 * 1000),
      },
    });

    return {
      purchase: {
        id: purchase.id,
        packId: purchase.pack_id,
        studentId: purchase.student_id,
        totalVnd: purchase.total_vnd,
        remainingSessions: purchase.remaining_sessions,
        installmentTotalPeriods: purchase.installment_total_periods,
        installmentPaidPeriods: purchase.installment_paid_periods,
        recurringSchedule: purchase.recurring_schedule,
        status: purchase.status,
        expiresAt: purchase.expires_at,
        createdAt: purchase.created_at,
      },
      chargedAmount: periodAmount,
      walletTxnId: chargeResult.txnId,
      installmentPeriods: totalPeriods ?? null,
    };
  }

  /** POST /tutoring/promo/redeem — WALLET_CREDIT cộng ví ngay, còn lại trả info. */
  async redeemPromo(userId: string, body: PromoRedeemInput) {
    const code = body.code.trim().toUpperCase();

    const promo = await this.prisma.promo_code.findUnique({ where: { code } });
    if (!promo) throw new NotFoundException({ error: 'Mã không hợp lệ' });

    const now = new Date();
    if (promo.valid_from && promo.valid_from > now) {
      throw new BadRequestException({ error: 'Mã chưa kích hoạt' });
    }
    if (promo.valid_until && promo.valid_until < now) {
      throw new BadRequestException({ error: 'Mã đã hết hạn' });
    }
    if (promo.max_uses != null && promo.uses_count >= promo.max_uses) {
      throw new BadRequestException({ error: 'Mã đã hết lượt' });
    }

    const count = await this.prisma.promo_code_redemption.count({
      where: { promo_code: code, user_id: userId },
    });
    if (count >= promo.per_user_limit) {
      throw new BadRequestException({
        error: `Bạn đã dùng mã này ${promo.per_user_limit} lần — không thể dùng tiếp`,
      });
    }

    if (promo.type === 'WALLET_CREDIT') {
      const expires = new Date(
        Date.now() + WALLET_CREDIT_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
      );
      await this.wallet.applyPromoCredit({
        userId,
        amountVnd: promo.value,
        expiresAt: expires,
        relatedId: code,
        description: `Promo ${code} +${promo.value.toLocaleString('vi-VN')}đ wallet credit`,
      });

      await this.prisma.$transaction([
        this.prisma.promo_code_redemption.create({
          data: { promo_code: code, user_id: userId, amount_vnd: promo.value },
        }),
        this.prisma.promo_code.update({
          where: { code },
          data: { uses_count: { increment: 1 } },
        }),
      ]);

      return {
        type: 'WALLET_CREDIT',
        creditedVnd: promo.value,
        expiresAt: expires,
        message: `Đã cộng ${promo.value.toLocaleString('vi-VN')}đ vào wallet credit`,
      };
    }

    // PERCENTAGE / FIXED_VND — persist redemption pending (amount=0), FE apply lúc checkout.
    await this.prisma.promo_code_redemption.createMany({
      data: [{ promo_code: code, user_id: userId, amount_vnd: 0 }],
      skipDuplicates: true,
    });

    return {
      type: promo.type,
      value: promo.value,
      minPurchaseVnd: promo.min_purchase_vnd,
      message:
        promo.type === 'PERCENTAGE'
          ? `Mã giảm ${promo.value}% — apply lúc thanh toán`
          : `Mã giảm ${promo.value.toLocaleString('vi-VN')}đ — apply lúc thanh toán`,
    };
  }

  /** GET /tutoring/favorites — ≤50 tutor đã favorite, mới nhất trước. */
  async listFavorites(userId: string) {
    const rows = await this.prisma.tutor_favorite.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
      take: 50,
      select: {
        created_at: true,
        tutor_profile: {
          select: {
            id: true,
            headline: true,
            hourly_rate_vnd: true,
            modality: true,
            avatar_url: true,
            rating_avg: true,
            rating_count: true,
            sessions_completed: true,
            verification_status: true,
            instant_book_enabled: true,
            avg_response_minutes: true,
            user: { select: { name: true } },
          },
        },
      },
    });

    return {
      favorites: rows.map((r) => ({
        tutorId: r.tutor_profile.id,
        headline: r.tutor_profile.headline,
        hourlyRateVnd: r.tutor_profile.hourly_rate_vnd,
        modality: r.tutor_profile.modality,
        avatarUrl: r.tutor_profile.avatar_url,
        // numeric(3,2) — giữ string "4.50" như Drizzle trả pg text.
        ratingAvg:
          r.tutor_profile.rating_avg === null
            ? null
            : r.tutor_profile.rating_avg.toFixed(2),
        ratingCount: r.tutor_profile.rating_count,
        sessionsCompleted: r.tutor_profile.sessions_completed,
        verificationStatus: r.tutor_profile.verification_status,
        instantBookEnabled: r.tutor_profile.instant_book_enabled,
        avgResponseMinutes: r.tutor_profile.avg_response_minutes,
        tutorName: r.tutor_profile.user.name,
        favoritedAt: r.created_at,
      })),
    };
  }
}
