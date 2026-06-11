/**
 * AdminKycService — port từ apps/web/src/app/api/admin/kyc/**.
 *
 * Route web LEGACY auth bằng isAdminEmail + KHÔNG audit; api ĐỒNG NHẤT sang
 * AdminGuard + withAudit (deviation có chủ đích theo khảo sát) — response
 * shape giữ y cũ.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../infra/database/prisma.service';
import { AdminAuditService } from '../../../common/admin/admin-audit.service';
import type { AdminContext } from '../../../common/admin/admin.guard';
import type { KycReviewInput } from './dto/admin-domain.dto';

@Injectable()
export class AdminKycService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
  ) {}

  /** GET /admin/kyc — queue group theo tutor, ?status default PENDING. */
  async listQueue(statusParam: string | undefined) {
    const status = statusParam ?? 'PENDING';

    const tutors = await this.prisma.$queryRaw<
      Array<{
        tutorId: string;
        tutorUserId: string;
        tutorName: string | null;
        tutorEmail: string;
        tutorAvatarUrl: string | null;
        headline: string;
        verificationStatus: string;
        docCount: number;
        pendingCount: number;
        latestUpload: Date;
      }>
    >(Prisma.sql`
      SELECT
        tp.id AS "tutorId",
        tp.user_id AS "tutorUserId",
        u.name AS "tutorName",
        u.email AS "tutorEmail",
        tp.avatar_url AS "tutorAvatarUrl",
        tp.headline AS "headline",
        tp.verification_status AS "verificationStatus",
        COUNT(d.id)::int AS "docCount",
        COUNT(CASE WHEN d.status = 'PENDING' THEN 1 END)::int AS "pendingCount",
        MAX(d.created_at) AS "latestUpload"
      FROM tutor_kyc_document d
      JOIN tutor_profile tp ON tp.id = d.tutor_id
      JOIN "user" u ON u.id = tp.user_id
      WHERE d.status = ${status}
      GROUP BY tp.id, tp.user_id, u.name, u.email, tp.avatar_url, tp.headline, tp.verification_status
      ORDER BY MAX(d.created_at) DESC
      LIMIT 50
    `);

    return { tutors };
  }

  /** PATCH /admin/kyc/:id — approve/reject doc + recompute verification status. */
  async review(ctx: AdminContext, id: string, body: KycReviewInput) {
    const doc = await this.prisma.tutor_kyc_document.findUnique({
      where: { id },
      select: { id: true, tutor_id: true, status: true },
    });
    if (!doc) throw new NotFoundException({ error: 'Not found' });

    const newStatus = body.action === 'APPROVE' ? 'APPROVED' : 'REJECTED';

    return this.audit.withAudit(ctx, 'kyc.review', { type: 'kyc_document', id }, async () => {
      await this.prisma.tutor_kyc_document.update({
        where: { id },
        data: {
          status: newStatus,
          reviewed_by: ctx.userId,
          review_note: body.note ?? null,
          reviewed_at: new Date(),
        },
      });

      // Recompute verification status — cần đủ CCCD_FRONT + CCCD_BACK +
      // (DEGREE hoặc CERTIFICATE) approved. Có thể HẠ CẤP tutor đã verified
      // nếu mất loại doc — giữ y semantics cũ.
      const approved = await this.prisma.tutor_kyc_document.findMany({
        where: { tutor_id: doc.tutor_id, status: 'APPROVED' },
        select: { doc_type: true },
      });
      const types = new Set(approved.map((d) => d.doc_type));
      const hasIdentity = types.has('CCCD_FRONT') && types.has('CCCD_BACK');
      const hasDegree = types.has('DEGREE') || types.has('CERTIFICATE');
      const fullyVerified = hasIdentity && hasDegree;
      const verificationStatus = fullyVerified ? 'KYC_VERIFIED' : 'KYC_PENDING';

      await this.prisma.tutor_profile.update({
        where: { id: doc.tutor_id },
        data: { verification_status: verificationStatus, updated_at: new Date() },
      });

      return {
        before: { status: doc.status },
        after: { status: newStatus, verificationStatus },
        reason: body.note,
        metadata: { action: body.action, tutorId: doc.tutor_id },
        result: { ok: true, verificationStatus },
      };
    });
  }
}
