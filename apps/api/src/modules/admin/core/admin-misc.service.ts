/**
 * AdminMiscService — audit log list, global ⌘K search, impersonation.
 *
 * Impersonation port từ apps/web/src/lib/admin/impersonation.ts (V1 marker):
 * cookie 'cogniva-imp' = base64url(JSON payload) + '.' + HMAC-SHA256 base64url,
 * KHÔNG swap session — chỉ banner + middleware web chặn mutation. Secret chain
 * IMPERSONATION_SECRET ?? BETTER_AUTH_SECRET ?? 'dev-only' giữ y cũ để cookie
 * web đã phát vẫn verify được trong cửa sổ strangler.
 */
import { createHmac, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { Response } from 'express';

import { PrismaService } from '../../../infra/database/prisma.service';
import { AdminAuditService } from '../../../common/admin/admin-audit.service';
import type { AdminContext } from '../../../common/admin/admin.guard';
import type { ImpersonateInput } from './dto/admin-core.dto';
import { parseDateParam, parseLimit } from './admin-core.util';

export const IMPERSONATION_COOKIE_NAME = 'cogniva-imp';
const MAX_DURATION_MIN = 60;
const PER_TYPE_LIMIT = 5;

export type ImpersonationPayload = {
  /** Random ID cho audit log correlate start↔stop. */
  sessionId: string;
  adminId: string;
  adminEmail: string;
  targetUserId: string;
  targetEmail: string;
  /** Unix millis — cookie hết hạn khi quá. */
  expiresAt: number;
  mode: 'readonly' | 'full';
};

function getSecret(): string {
  return process.env.IMPERSONATION_SECRET ?? process.env.BETTER_AUTH_SECRET ?? 'dev-only';
}

function sign(value: string): string {
  return createHmac('sha256', getSecret()).update(value).digest('base64url');
}

function encodeCookie(payload: ImpersonationPayload): string {
  const b64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${b64}.${sign(b64)}`;
}

function decodeCookie(value: string): ImpersonationPayload | null {
  const [b64, sig] = value.split('.');
  if (!b64 || !sig) return null;
  if (sign(b64) !== sig) return null;
  try {
    const payload = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'));
    if (typeof payload !== 'object' || payload === null) return null;
    if (typeof payload.expiresAt !== 'number' || Date.now() > payload.expiresAt) {
      return null;
    }
    return payload as ImpersonationPayload;
  } catch {
    return null;
  }
}

type AdminSearchHit = {
  type: 'user' | 'document' | 'conversation' | 'group' | 'booking';
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
};

@Injectable()
export class AdminMiscService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
  ) {}

  // ── GET /admin/audit ─────────────────────────────────────────────
  async listAudit(query: {
    adminEmail?: string;
    action?: string;
    targetType?: string;
    targetId?: string;
    from?: string;
    to?: string;
    cursor?: string;
    limit?: string;
  }) {
    const adminEmail = query.adminEmail?.trim() ?? '';
    const action = query.action?.trim() ?? '';
    const targetType = query.targetType?.trim() ?? '';
    const targetId = query.targetId?.trim() ?? '';
    const limit = parseLimit(query.limit);
    const from = parseDateParam(query.from) ?? defaultFrom();
    const to = parseDateParam(query.to) ?? new Date();

    const conditions: Prisma.admin_audit_logWhereInput[] = [
      { created_at: { gte: from } },
      { created_at: { lt: to } },
    ];
    if (adminEmail) {
      conditions.push({ user: { email: { contains: adminEmail, mode: 'insensitive' } } });
    }
    if (action) conditions.push({ action: { contains: action, mode: 'insensitive' } });
    if (targetType) conditions.push({ target_type: targetType });
    if (targetId) conditions.push({ target_id: targetId });
    const cursor = parseDateParam(query.cursor);
    if (cursor) conditions.push({ created_at: { lt: cursor } });

    const rows = await this.prisma.admin_audit_log.findMany({
      where: { AND: conditions },
      select: {
        id: true,
        admin_id: true,
        action: true,
        target_type: true,
        target_id: true,
        payload: true,
        ip: true,
        user_agent: true,
        created_at: true,
        user: { select: { name: true, email: true } },
      },
      orderBy: { created_at: 'desc' },
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const trimmed = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor =
      hasMore && trimmed.length > 0
        ? trimmed[trimmed.length - 1]!.created_at.toISOString()
        : null;

    // Distinct values cho filter dropdown — y route cũ (2 query mỗi request).
    const [actionsRaw, targetTypesRaw] = await Promise.all([
      this.prisma.$queryRaw<Array<{ action: string }>>`
        SELECT DISTINCT action FROM "admin_audit_log" ORDER BY action LIMIT 50`,
      this.prisma.$queryRaw<Array<{ target_type: string }>>`
        SELECT DISTINCT target_type FROM "admin_audit_log" ORDER BY target_type LIMIT 30`,
    ]);

    return {
      entries: trimmed.map((e) => ({
        id: e.id,
        adminId: e.admin_id,
        adminName: e.user.name,
        adminEmail: e.user.email,
        action: e.action,
        targetType: e.target_type,
        targetId: e.target_id,
        payload: e.payload,
        ip: e.ip,
        userAgent: e.user_agent,
        createdAt: e.created_at.toISOString(),
      })),
      nextCursor,
      distinct: {
        actions: actionsRaw.map((r) => r.action),
        targetTypes: targetTypesRaw.map((r) => r.target_type),
      },
    };
  }

  // ── GET /admin/search ────────────────────────────────────────────
  async search(qRaw: string | undefined) {
    const q = qRaw?.trim() ?? '';
    if (q.length < 2) return { hits: [] as AdminSearchHit[] };
    const pattern = `%${q}%`;

    const [users, docs, convs, groups, bookings] = await Promise.all([
      this.prisma.user.findMany({
        where: {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { email: { contains: q, mode: 'insensitive' } },
          ],
        },
        select: { id: true, name: true, email: true, plan: true, suspended_at: true },
        take: PER_TYPE_LIMIT,
      }),
      this.prisma.document.findMany({
        where: { filename: { contains: q, mode: 'insensitive' } },
        select: { id: true, filename: true, status: true, user: { select: { email: true } } },
        orderBy: { created_at: 'desc' },
        take: PER_TYPE_LIMIT,
      }),
      this.prisma.conversation.findMany({
        where: { title: { contains: q, mode: 'insensitive' } },
        select: { id: true, title: true, user: { select: { email: true } } },
        orderBy: { created_at: 'desc' },
        take: PER_TYPE_LIMIT,
      }),
      this.prisma.study_group.findMany({
        where: { name: { contains: q, mode: 'insensitive' } },
        select: {
          id: true,
          name: true,
          suspended_at: true,
          _count: { select: { study_group_member: true } },
        },
        take: PER_TYPE_LIMIT,
      }),
      // Booking: search email tutor/student qua 2 join user — raw SQL vì
      // Prisma không alias 1 bảng 2 lần trong findMany.
      this.prisma.$queryRaw<
        Array<{
          id: string;
          subject_slug: string;
          status: string;
          start_at: Date;
          tutor_email: string | null;
          student_email: string | null;
        }>
      >`
        SELECT b.id, b.subject_slug, b.status, b.start_at,
               tu.email AS tutor_email, su.email AS student_email
        FROM "tutoring_booking" b
        LEFT JOIN "tutor_profile" tp ON tp.id = b.tutor_id
        LEFT JOIN "user" tu ON tu.id = tp.user_id
        LEFT JOIN "user" su ON su.id = b.student_id
        WHERE tu.email ILIKE ${pattern}
           OR su.email ILIKE ${pattern}
           OR (${q.length >= 6} AND b.id = ${q})
        ORDER BY b.start_at DESC
        LIMIT 5`,
    ]);

    const hits: AdminSearchHit[] = [
      ...users.map((u) => ({
        type: 'user' as const,
        id: u.id,
        title: u.name ?? u.email,
        subtitle: `${u.email} · ${u.plan}${u.suspended_at ? ' · suspended' : ''}`,
        href: `/admin/users/${u.id}`,
      })),
      ...docs.map((d) => ({
        type: 'document' as const,
        id: d.id,
        title: d.filename,
        subtitle: `${d.status}${d.user?.email ? ` · ${d.user.email}` : ''}`,
        href: `/admin/documents/${d.id}`,
      })),
      ...convs.map((c) => ({
        type: 'conversation' as const,
        id: c.id,
        title: c.title || '— không có tiêu đề —',
        subtitle: c.user?.email ?? null,
        href: `/admin/conversations/${c.id}`,
      })),
      ...groups.map((g) => ({
        type: 'group' as const,
        id: g.id,
        title: g.name,
        subtitle: `${g._count.study_group_member} members${g.suspended_at ? ' · suspended' : ''}`,
        href: `/admin/groups/${g.id}`,
      })),
      ...bookings.map((b) => ({
        type: 'booking' as const,
        id: b.id,
        title: `${b.subject_slug} · ${new Date(b.start_at).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`,
        subtitle: `${b.status} · ${b.student_email ?? '—'} ← ${b.tutor_email ?? '—'}`,
        href: `/admin/tutoring/bookings/${b.id}`,
      })),
    ];

    return { hits };
  }

  // ── POST /admin/impersonate ──────────────────────────────────────
  async startImpersonation(ctx: AdminContext, dto: ImpersonateInput, res: Response) {
    const { userId, reason, durationMin } = dto;

    if (userId === ctx.userId) {
      throw new BadRequestException({ error: 'Không thể impersonate chính mình' });
    }

    const target = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, admin_role: true },
    });
    if (!target) {
      throw new NotFoundException({ error: 'Target user không tồn tại' });
    }
    if (target.admin_role === 'SUPER_ADMIN' && ctx.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException({ error: 'Không thể impersonate SUPER_ADMIN' });
    }

    // Audit trước, set cookie sau — nếu audit fail không impersonate (y cũ).
    await this.audit.withAudit(
      ctx,
      'impersonation.start',
      { type: 'user', id: userId },
      async () => {
        this.setImpersonationCookie(res, {
          adminId: ctx.userId,
          adminEmail: ctx.email,
          targetUserId: target.id,
          targetEmail: target.email,
          mode: 'readonly',
          durationMin,
        });
        return {
          before: null,
          after: {
            targetUserId: target.id,
            targetEmail: target.email,
            mode: 'readonly',
            durationMin: durationMin ?? 30,
          },
          reason,
          result: { ok: true },
        };
      },
    );

    return { ok: true };
  }

  // ── DELETE /admin/impersonate ────────────────────────────────────
  async stopImpersonation(ctx: AdminContext, rawCookie: string | undefined, res: Response) {
    const current = rawCookie ? decodeCookie(rawCookie) : null;
    if (!current) {
      this.clearImpersonationCookie(res);
      return { ok: true, wasActive: false };
    }

    await this.audit.withAudit(
      ctx,
      'impersonation.stop',
      { type: 'user', id: current.targetUserId },
      async () => {
        this.clearImpersonationCookie(res);
        return {
          before: { sessionId: current.sessionId, targetUserId: current.targetUserId },
          after: null,
          reason: 'Admin chủ động stop',
          result: { ok: true },
        };
      },
    );

    return { ok: true, wasActive: true };
  }

  private setImpersonationCookie(
    res: Response,
    payload: Omit<ImpersonationPayload, 'sessionId' | 'expiresAt'> & { durationMin?: number },
  ): void {
    const durationMin = Math.min(MAX_DURATION_MIN, Math.max(5, payload.durationMin ?? 30));
    const full: ImpersonationPayload = {
      sessionId: randomUUID(),
      adminId: payload.adminId,
      adminEmail: payload.adminEmail,
      targetUserId: payload.targetUserId,
      targetEmail: payload.targetEmail,
      mode: payload.mode,
      expiresAt: Date.now() + durationMin * 60_000,
    };
    res.cookie(IMPERSONATION_COOKIE_NAME, encodeCookie(full), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      // Express maxAge tính bằng MILLISECONDS (Next cookies() là seconds).
      maxAge: durationMin * 60_000,
    });
  }

  private clearImpersonationCookie(res: Response): void {
    res.clearCookie(IMPERSONATION_COOKIE_NAME, { path: '/' });
  }
}

function defaultFrom(): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 30);
  return d;
}
