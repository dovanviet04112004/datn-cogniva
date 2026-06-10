/**
 * RefreshTokenService — refresh token 30 ngày, opaque, ROTATION + REUSE-
 * DETECTION theo family (plan §3.1):
 *  - DB chỉ lưu SHA-256 hash; raw token chỉ tồn tại ở client.
 *  - Mỗi lần refresh: token cũ bị revoke + phát token mới CÙNG family.
 *  - Dùng lại token đã revoke (cùng family) = dấu hiệu token bị trộm →
 *    revoke CẢ family, mọi thiết bị của family đó phải đăng nhập lại.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { Injectable, UnauthorizedException } from '@nestjs/common';

import { PrismaService } from '../../infra/database/prisma.service';

const TTL_MS = 30 * 24 * 60 * 60 * 1000;

const sha256 = (raw: string) => createHash('sha256').update(raw).digest('hex');

export interface IssuedRefreshToken {
  /** Raw token trả về client — KHÔNG lưu server. */
  raw: string;
  familyId: string;
  expiresAt: Date;
}

@Injectable()
export class RefreshTokenService {
  constructor(private readonly prisma: PrismaService) {}

  async issue(userId: string, opts?: { familyId?: string; ip?: string; userAgent?: string }): Promise<IssuedRefreshToken> {
    const raw = randomBytes(48).toString('base64url');
    const familyId = opts?.familyId ?? randomUUID();
    const expiresAt = new Date(Date.now() + TTL_MS);
    await this.prisma.refresh_token.create({
      data: {
        id: randomUUID(),
        user_id: userId,
        token_hash: sha256(raw),
        family_id: familyId,
        expires_at: expiresAt,
        ip_address: opts?.ip ?? null,
        user_agent: opts?.userAgent ?? null,
      },
    });
    return { raw, familyId, expiresAt };
  }

  /**
   * Rotation: token hợp lệ → revoke nó + phát token mới cùng family, trả về
   * userId. Token đã revoke → reuse detected → revoke family + 401.
   */
  async rotate(raw: string, opts?: { ip?: string; userAgent?: string }): Promise<{ userId: string; next: IssuedRefreshToken }> {
    const row = await this.prisma.refresh_token.findUnique({ where: { token_hash: sha256(raw) } });
    if (!row || row.expires_at <= new Date()) {
      throw new UnauthorizedException({ error: 'Refresh token không hợp lệ hoặc đã hết hạn' });
    }
    if (row.revoked_at) {
      await this.revokeFamily(row.family_id);
      throw new UnauthorizedException({ error: 'Refresh token đã bị dùng lại — toàn bộ phiên của thiết bị này bị thu hồi' });
    }

    const next = await this.issue(row.user_id, { familyId: row.family_id, ...opts });
    await this.prisma.refresh_token.update({
      where: { id: row.id },
      data: { revoked_at: new Date(), replaced_by: sha256(next.raw) },
    });
    return { userId: row.user_id, next };
  }

  /** Revoke 1 family từ raw token (sign-out 1 thiết bị) — token lạ thì bỏ qua. */
  async revokeByRaw(raw: string): Promise<void> {
    const row = await this.prisma.refresh_token.findUnique({ where: { token_hash: sha256(raw) } });
    if (row) await this.revokeFamily(row.family_id);
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refresh_token.updateMany({
      where: { family_id: familyId, revoked_at: null },
      data: { revoked_at: new Date() },
    });
  }

  /** Revoke MỌI phiên của user (reset password, suspend, force-signout). */
  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refresh_token.updateMany({
      where: { user_id: userId, revoked_at: null },
      data: { revoked_at: new Date() },
    });
  }
}
