/**
 * LegacySessionIssuerService — DUAL-ISSUE (XÓA khi gỡ Better Auth cuối GĐ1):
 * sign-in/up ở flow MỚI tạo thêm 1 session Better Auth (row bảng `session` +
 * cookie ký HMAC) để toàn bộ SSR/API cũ của Next (`auth.api.getSession`) vẫn
 * nhận ra user — web client switch sang endpoint mới mà KHÔNG phải sửa hàng
 * trăm điểm getSession cùng lúc.
 */
import { createHmac, randomBytes, randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../../infra/database/prisma.service';

const TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface LegacySession {
  /** Giá trị cookie `better-auth.session_token` (= `<token>.<sig>`). */
  cookieValue: string;
  expiresAt: Date;
}

@Injectable()
export class LegacySessionIssuerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async issue(userId: string, meta?: { ip?: string; userAgent?: string }): Promise<LegacySession> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + TTL_MS);
    await this.prisma.session.create({
      data: {
        id: randomUUID(),
        user_id: userId,
        token,
        expires_at: expiresAt,
        ip_address: meta?.ip ?? null,
        user_agent: meta?.userAgent ?? null,
      },
    });
    const sig = createHmac('sha256', this.config.getOrThrow<string>('BETTER_AUTH_SECRET'))
      .update(token)
      .digest('base64url');
    return { cookieValue: `${token}.${sig}`, expiresAt };
  }
}
