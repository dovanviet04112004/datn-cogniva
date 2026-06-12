import { randomUUID } from 'node:crypto';
import { BadRequestException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { cached } from '@cogniva/server-core/cache/cache-aside';
import { ck } from '@cogniva/server-core/cache/keys';

import { PrismaService } from '../../../infra/database/prisma.service';
import { InsufficientBalanceError, WalletService } from '../../payments/wallet.service';
import type { PackPurchaseInput, PromoRedeemInput } from './dto/market.dto';

const PACK_EXPIRES_DAYS = 90;
const WALLET_CREDIT_EXPIRY_DAYS = 60;

const REQUEST_PAGE_SIZES = [12, 24, 48, 96];
const REQUEST_DEFAULT_PAGE_SIZE = 24;

export interface RequestsBrowseQuery {
  subject?: string;
  level?: string;
  modality?: string;
  urgency?: string;
  sort?: string;
  page?: string;
  per?: string;
}

interface RequestBrowseRow {
  id: string;
  title: string;
  description: string;
  subject_slug: string;
  level: string;
  budget_vnd: number | null;
  modality: string;
  urgency: string;
  created_at: Date;
  student_id: string;
  student_name: string | null;
  student_image: string | null;
}

@Injectable()
export class TutoringMarketService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
  ) {}

  async listClasses(query: { subject?: string; level?: string; from?: string }) {
    const from = query.from ? new Date(query.from) : new Date();

    const where: Prisma.tutoring_classWhereInput = {
      status: 'OPEN',
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
        startDate: c.start_date.toISOString().slice(0, 10),
        status: c.status,
        tutorHeadline: c.tutor_profile.headline,
        tutorAvatarUrl: c.tutor_profile.avatar_url,
        tutorName: c.tutor_profile.user.name,
      })),
    };
  }

  async purchasePack(userId: string, packId: string, body: PackPurchaseInput) {
    const pack = await this.prisma.tutoring_pack.findUnique({ where: { id: packId } });
    if (!pack || pack.status !== 'ACTIVE') {
      throw new NotFoundException({ error: 'Pack không khả dụng' });
    }

    const totalPeriods = body.installmentPeriods;
    const periodAmount = totalPeriods ? Math.ceil(pack.total_vnd / totalPeriods) : pack.total_vnd;

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
      const expires = new Date(Date.now() + WALLET_CREDIT_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
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
        ratingAvg:
          r.tutor_profile.rating_avg === null ? null : r.tutor_profile.rating_avg.toFixed(2),
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

  async getMyProfile(userId: string) {
    const row = await this.prisma.tutor_profile.findUnique({
      where: { user_id: userId },
      select: { id: true, status: true },
    });
    return row ? { id: row.id, status: row.status } : null;
  }

  async getMyKyc(userId: string) {
    const profile = await this.prisma.tutor_profile.findUnique({
      where: { user_id: userId },
      select: { id: true, verification_status: true, status: true },
    });
    if (!profile) {
      return { profile: null, documents: [] };
    }

    const docs = await this.prisma.tutor_kyc_document.findMany({
      where: { tutor_id: profile.id },
      orderBy: { created_at: 'desc' },
    });

    return {
      profile: {
        id: profile.id,
        verificationStatus: profile.verification_status,
        status: profile.status,
      },
      documents: docs.map((d) => ({
        id: d.id,
        docType: d.doc_type,
        storageKey: d.storage_key,
        mimeType: d.mime_type,
        sizeBytes: d.size_bytes,
        originalName: d.original_name,
        status: d.status,
        reviewNote: d.review_note,
        createdAt: d.created_at,
      })),
    };
  }

  async getMineTab(userId: string) {
    return cached(ck.mineTab(userId), 120, async () => {
      const [profileRow, requestRows] = await Promise.all([
        this.prisma.tutor_profile.findUnique({ where: { user_id: userId } }),
        this.prisma.tutor_request.findMany({
          where: { student_id: userId },
          orderBy: { created_at: 'desc' },
          take: 10,
          select: {
            id: true,
            title: true,
            subject_slug: true,
            level: true,
            modality: true,
            urgency: true,
            status: true,
            budget_vnd: true,
            created_at: true,
          },
        }),
      ]);

      const bookingRows = await this.prisma.tutoring_booking.findMany({
        where: {
          start_at: { gte: new Date() },
          OR: profileRow
            ? [{ student_id: userId }, { tutor_id: profileRow.id }]
            : [{ student_id: userId }],
        },
        orderBy: { start_at: 'asc' },
        take: 5,
        select: {
          id: true,
          tutor_id: true,
          student_id: true,
          subject_slug: true,
          start_at: true,
          end_at: true,
          status: true,
          tutor_profile: {
            select: { avatar_url: true, user: { select: { name: true } } },
          },
        },
      });

      const applicationRows = profileRow
        ? await this.prisma.tutor_application.findMany({
            where: { tutor_id: profileRow.id },
            orderBy: { created_at: 'desc' },
            take: 10,
            select: {
              id: true,
              request_id: true,
              status: true,
              proposed_rate_vnd: true,
              created_at: true,
              tutor_request: {
                select: { title: true, subject_slug: true, level: true, status: true },
              },
            },
          })
        : [];

      return {
        myProfile: profileRow
          ? {
              id: profileRow.id,
              userId: profileRow.user_id,
              headline: profileRow.headline,
              bio: profileRow.bio,
              hourlyRateVnd: profileRow.hourly_rate_vnd,
              modality: profileRow.modality,
              avatarUrl: profileRow.avatar_url,
              bannerUrl: profileRow.banner_url,
              sessionsCompleted: profileRow.sessions_completed,
              ratingAvg: profileRow.rating_avg === null ? null : profileRow.rating_avg.toFixed(2),
              ratingCount: profileRow.rating_count,
              verificationStatus: profileRow.verification_status,
              status: profileRow.status,
              instantBookEnabled: profileRow.instant_book_enabled,
              trialSessionEnabled: profileRow.trial_session_enabled,
              avgResponseMinutes: profileRow.avg_response_minutes,
              responseRatePct: profileRow.response_rate_pct,
              introVideoUrl: profileRow.intro_video_url,
              introVideoThumbUrl: profileRow.intro_video_thumb_url,
              createdAt: profileRow.created_at,
              updatedAt: profileRow.updated_at,
            }
          : null,
        myRequests: requestRows.map((r) => ({
          id: r.id,
          title: r.title,
          subjectSlug: r.subject_slug,
          level: r.level,
          modality: r.modality,
          urgency: r.urgency,
          status: r.status,
          budgetVnd: r.budget_vnd,
          createdAt: r.created_at,
        })),
        upcomingBookings: bookingRows.map((b) => ({
          id: b.id,
          tutorId: b.tutor_id,
          studentId: b.student_id,
          subjectSlug: b.subject_slug,
          startAt: b.start_at,
          endAt: b.end_at,
          status: b.status,
          tutorName: b.tutor_profile.user.name,
          tutorAvatarUrl: b.tutor_profile.avatar_url,
        })),
        myApplications: applicationRows.map((a) => ({
          id: a.id,
          requestId: a.request_id,
          status: a.status,
          proposedRateVnd: a.proposed_rate_vnd,
          createdAt: a.created_at,
          requestTitle: a.tutor_request.title,
          requestSubject: a.tutor_request.subject_slug,
          requestLevel: a.tutor_request.level,
          requestStatus: a.tutor_request.status,
        })),
      };
    });
  }

  async browseRequests(query: RequestsBrowseQuery) {
    const page = Math.max(1, parseInt(query.page ?? '1', 10) || 1);
    const perParsed = parseInt(query.per ?? '', 10);
    const pageSize = REQUEST_PAGE_SIZES.includes(perParsed) ? perParsed : REQUEST_DEFAULT_PAGE_SIZE;
    const offset = (page - 1) * pageSize;
    const sort = query.sort ?? 'urgency';

    const conds: Prisma.Sql[] = [Prisma.sql`tr.status = 'OPEN'`];
    const countWhere: Prisma.tutor_requestWhereInput = { status: 'OPEN' };
    if (query.subject) {
      conds.push(Prisma.sql`tr.subject_slug = ${query.subject}`);
      countWhere.subject_slug = query.subject;
    }
    if (query.level) {
      conds.push(Prisma.sql`tr.level = ${query.level}`);
      countWhere.level = query.level;
    }
    if (query.modality) {
      conds.push(Prisma.sql`tr.modality = ${query.modality}`);
      countWhere.modality = query.modality;
    }
    if (query.urgency) {
      conds.push(Prisma.sql`tr.urgency = ${query.urgency}`);
      countWhere.urgency = query.urgency;
    }
    const where = Prisma.join(conds, ' AND ');

    const orderBy = (() => {
      switch (sort) {
        case 'newest':
          return Prisma.sql`tr.created_at DESC`;
        case 'budget-high':
          return Prisma.sql`tr.budget_vnd DESC, tr.created_at DESC`;
        case 'budget-low':
          return Prisma.sql`tr.budget_vnd ASC, tr.created_at DESC`;
        case 'urgency':
        default:
          return Prisma.sql`CASE tr.urgency
              WHEN 'ASAP' THEN 3
              WHEN 'THIS_WEEK' THEN 2
              WHEN 'THIS_MONTH' THEN 1
              ELSE 0
            END DESC, tr.created_at DESC`;
      }
    })();

    const [totalCount, rows] = await Promise.all([
      this.prisma.tutor_request.count({ where: countWhere }),
      this.prisma.$queryRaw<RequestBrowseRow[]>(Prisma.sql`
        SELECT tr.id, tr.title, tr.description, tr.subject_slug, tr.level, tr.budget_vnd,
               tr.modality, tr.urgency, tr.created_at, tr.student_id,
               u.name AS student_name, u.image AS student_image
        FROM tutor_request tr
        INNER JOIN "user" u ON u.id = tr.student_id
        WHERE ${where}
        ORDER BY ${orderBy}
        LIMIT ${pageSize} OFFSET ${offset}`),
    ]);

    return {
      totalCount,
      requests: rows.map((r) => ({
        id: r.id,
        title: r.title,
        description: r.description,
        subjectSlug: r.subject_slug,
        level: r.level,
        budgetVnd: r.budget_vnd,
        modality: r.modality,
        urgency: r.urgency,
        createdAt: r.created_at,
        studentId: r.student_id,
        studentName: r.student_name,
        studentImage: r.student_image,
      })),
    };
  }
}
