/**
 * AuthGuard toàn cục — JWT thuần (plan §3, dual-accept Better Auth đã gỡ
 * cuối GĐ1): access token ES256 qua Bearer hoặc cookie `cg_at`, verify cục
 * bộ không chạm Redis/DB. Route public đánh dấu @Public().
 */
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { TokenService } from '../auth/token.service';
import type { AuthContext } from '../auth/session.types';

const ACCESS_COOKIE = 'cg_at';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    const auth = await this.resolve(req);
    if (!auth) throw new UnauthorizedException({ error: 'Unauthorized' });

    Object.assign(req, { user: auth.user, session: auth.session });
    return true;
  }

  private async resolve(req: Request): Promise<AuthContext | null> {
    const cookies = parseCookies(req.headers.cookie);
    const bearer = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];

    const jwtCandidate = bearer ?? cookies[ACCESS_COOKIE];
    if (!jwtCandidate) return null;

    const payload = await this.tokens.verifyAccessToken(jwtCandidate);
    if (!payload) return null;
    return {
      user: {
        id: payload.sub,
        email: payload.email,
        name: payload.name,
        image: payload.picture,
        plan: payload.plan,
        adminRole: payload.role,
      },
      session: { id: payload.sub, token: jwtCandidate, userId: payload.sub, expiresAt: new Date() },
    };
  }
}

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return out;
}
