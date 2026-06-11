import { Injectable } from '@nestjs/common';
import type { Request } from 'express';

import { TokenService } from './token.service';
import type { AuthUser } from './session.types';

const ACCESS_COOKIE = 'cg_at';

@Injectable()
export class OptionalAuthService {
  constructor(private readonly tokens: TokenService) {}

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
