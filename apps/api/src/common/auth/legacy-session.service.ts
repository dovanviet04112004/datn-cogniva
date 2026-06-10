/**
 * LegacySessionService — verify session Better Auth CŨ trong cửa sổ chuyển
 * tiếp (dual-accept, plan §3.3). Sẽ XÓA khi gỡ Better Auth cuối GĐ1.
 *
 * Format đã verify từ better-auth@1.6.10:
 *  - Cookie/Bearer value = `<token>.<HMAC-SHA256(secret, token) base64url-nopad>`
 *  - Redis key `ba:<token>` = JSON { session, user } (secondaryStorage)
 *  - Redis miss → fallback bảng session/user (storeSessionInDatabase=true)
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../../infra/database/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import type { AuthContext } from './session.types';

const REDIS_PREFIX = 'ba:';

interface SessionRow {
  id: string;
  token: string;
  user_id: string;
  expires_at: Date;
  email: string;
  name: string | null;
  image: string | null;
  plan: string | null;
  admin_role: string | null;
}

@Injectable()
export class LegacySessionService {
  constructor(
    private readonly config: ConfigService,
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  /** `<token>.<sig>` → token nếu chữ ký đúng, ngược lại null. */
  private extractToken(signedValue: string): string | null {
    const decoded = decodeURIComponent(signedValue);
    const dot = decoded.indexOf('.');
    if (dot <= 0) return null;
    const token = decoded.slice(0, dot);
    const sig = decoded.slice(dot + 1);
    const expected = createHmac('sha256', this.config.getOrThrow<string>('BETTER_AUTH_SECRET'))
      .update(token)
      .digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    return token;
  }

  async verify(signedValue: string): Promise<AuthContext | null> {
    const token = this.extractToken(signedValue);
    if (!token) return null;

    const cached = await this.redis.getSafe(`${REDIS_PREFIX}${token}`);
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as AuthContext;
        if (parsed.session && parsed.user && new Date(parsed.session.expiresAt) > new Date()) {
          return parsed;
        }
      } catch {
        /* JSON hỏng → rơi xuống DB */
      }
    }

    const rows = await this.prisma.$queryRaw<SessionRow[]>`
      SELECT s.id, s.token, s.user_id, s.expires_at,
             u.email, u.name, u.image, u.plan, u.admin_role
      FROM "session" s
      JOIN "user" u ON u.id = s.user_id
      WHERE s.token = ${token} AND s.expires_at > now()
      LIMIT 1`;
    const row = rows[0];
    if (!row) return null;

    return {
      session: { id: row.id, token: row.token, userId: row.user_id, expiresAt: row.expires_at },
      user: {
        id: row.user_id,
        email: row.email,
        name: row.name,
        image: row.image,
        plan: row.plan,
        adminRole: row.admin_role,
      },
    };
  }
}
