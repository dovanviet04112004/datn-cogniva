/**
 * AuthGuard toàn cục — JWT-FIRST (plan §3):
 *   (a) Access token JWT mới (Bearer hoặc cookie `cg_at`) → verify ES256 cục bộ.
 *   (b) Dual-accept session Better Auth cũ (cookie/Bearer ký HMAC) — chỉ tồn
 *       tại trong cửa sổ chuyển tiếp, gỡ cuối GĐ1 cùng LegacySessionService.
 * Route public đánh dấu @Public().
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
import { LegacySessionService } from '../auth/legacy-session.service';
import { TokenService } from '../auth/token.service';
import type { AuthContext } from '../auth/session.types';

const LEGACY_COOKIES = ['__Secure-better-auth.session_token', 'better-auth.session_token'];
const ACCESS_COOKIE = 'cg_at';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly legacy: LegacySessionService,
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

    // (a) JWT mới — 3 segment. Verify cục bộ, không chạm Redis/DB.
    const jwtCandidate = bearer && bearer.split('.').length === 3 ? bearer : cookies[ACCESS_COOKIE];
    if (jwtCandidate) {
      const payload = await this.tokens.verifyAccessToken(jwtCandidate);
      if (payload) {
        return {
          user: {
            id: payload.sub,
            email: payload.email,
            name: null,
            plan: payload.plan,
            adminRole: payload.role,
          },
          session: { id: payload.sub, token: jwtCandidate, userId: payload.sub, expiresAt: new Date() },
        };
      }
    }

    // (b) Legacy Better Auth: `<token>.<sig>` (2 phần) qua cookie hoặc Bearer.
    const legacyValue =
      LEGACY_COOKIES.map((n) => cookies[n]).find(Boolean) ??
      (bearer && bearer.split('.').length === 2 ? bearer : undefined);
    if (legacyValue) return this.legacy.verify(legacyValue);

    return null;
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
