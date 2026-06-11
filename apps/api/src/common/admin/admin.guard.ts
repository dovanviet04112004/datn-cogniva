import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { PrismaService } from '../../infra/database/prisma.service';

export type AdminRole = 'SUPER_ADMIN' | 'ADMIN' | 'SUPPORT';

export type AdminContext = {
  userId: string;
  email: string;
  name: string | null;
  role: AdminRole;
  ip: string | null;
  userAgent: string | null;
};

const ROLES_KEY = 'adminRoles';
export const AdminRoles = (...roles: AdminRole[]) => SetMetadata(ROLES_KEY, roles);

export const AdminCtx = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AdminContext => ctx.switchToHttp().getRequest().adminCtx,
);

const ADMIN_EMAIL_FALLBACK = ['dovanviet04112004@gmail.com'];

function parseAdminEmails(): string[] {
  const raw = process.env.ADMIN_EMAILS;
  if (raw && raw.length > 0) {
    return raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  }
  return ADMIN_EMAIL_FALLBACK;
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return parseAdminEmails().includes(email.toLowerCase());
}

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const authUser = req.user as { id: string } | undefined;
    if (!authUser) throw new UnauthorizedException({ error: 'Unauthorized' });

    const row = await this.prisma.user.findUnique({
      where: { id: authUser.id },
      select: { id: true, email: true, name: true, admin_role: true, suspended_at: true },
    });
    if (!row || row.suspended_at) throw new UnauthorizedException({ error: 'Unauthorized' });

    const role = (row.admin_role ??
      (isAdminEmail(row.email) ? 'SUPER_ADMIN' : null)) as AdminRole | null;
    if (!role) throw new UnauthorizedException({ error: 'Unauthorized' });

    const allowed = this.reflector.getAllAndOverride<AdminRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowed && allowed.length > 0 && !allowed.includes(role)) {
      throw new ForbiddenException({ error: 'Forbidden', requiredRoles: allowed });
    }

    const fwd = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim();
    req.adminCtx = {
      userId: row.id,
      email: row.email,
      name: row.name,
      role,
      ip: fwd ?? (req.headers['x-real-ip'] as string | undefined) ?? null,
      userAgent: (req.headers['user-agent'] as string | undefined) ?? null,
    } satisfies AdminContext;
    return true;
  }
}
