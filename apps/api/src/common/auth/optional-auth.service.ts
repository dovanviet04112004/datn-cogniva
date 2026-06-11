/**
 * OptionalAuthService — resolve session "best-effort" cho route @Public()
 * nhưng có hành vi per-user khi đã login (library doc detail ghi "Vừa xem",
 * annotations list thấy thêm note private, atom map overlay mastery...).
 * Route cũ gọi auth.api.getSession không chặn 401 → đây trả null thay vì throw.
 *
 * Logic verify COPY từ common/guards/auth.guard.ts (method resolve là private,
 * không tái dùng được) — đổi cách verify token thì sửa CẢ HAI chỗ.
 */
import { Injectable } from '@nestjs/common';
import type { Request } from 'express';

import { TokenService } from './token.service';
import type { AuthUser } from './session.types';

const ACCESS_COOKIE = 'cg_at';

@Injectable()
export class OptionalAuthService {
  constructor(private readonly tokens: TokenService) {}

  /** Trả AuthUser nếu request có JWT hợp lệ, ngược lại null (không throw). */
  async resolveUser(req: Request): Promise<AuthUser | null> {
    const cookies = parseCookies(req.headers.cookie);
    const bearer = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];

    const jwtCandidate = bearer ?? cookies[ACCESS_COOKIE];
    if (!jwtCandidate) return null;

    const payload = await this.tokens.verifyAccessToken(jwtCandidate);
    if (!payload) return null;
    return {
      id: payload.sub,
      email: payload.email,
      name: payload.name,
      image: payload.picture,
      plan: payload.plan,
      adminRole: payload.role,
    };
  }

  /** Tiện ích cho caller chỉ cần userId (annotations/endorse/atoms). */
  async resolveUserId(req: Request): Promise<string | null> {
    return (await this.resolveUser(req))?.id ?? null;
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
