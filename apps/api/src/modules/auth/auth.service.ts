/**
 * AuthService — nghiệp vụ auth JWT mới (plan §3): đăng ký/đăng nhập email+
 * password (hash tương thích Better Auth — xem PasswordService), phát cặp
 * access (15') + refresh (30d rotation), forgot/reset password.
 *
 * Còn lại trong Wave 1 (chưa ở file này): Google OAuth, 2FA TOTP — user có
 * two_factor_enabled tạm bị chặn ở flow mới (403) và vẫn đăng nhập qua
 * Better Auth cũ (dual-stack, không mất chức năng).
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';

import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PasswordService } from '../../common/auth/password.service';
import { TokenService } from '../../common/auth/token.service';
import type { AuthUser } from '../../common/auth/session.types';
import { PrismaService } from '../../infra/database/prisma.service';
import { RefreshTokenService } from './refresh-token.service';
import { TwoFactorManageService } from './two-factor-manage.service';
import { TwoFactorService } from './two-factor.service';

const CREDENTIAL_PROVIDER = 'credential';
const RESET_TTL_MS = 60 * 60 * 1000;

const sha256 = (raw: string) => createHash('sha256').update(raw).digest('hex');

export interface AuthTokens {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
}

export interface TwoFactorChallenge {
  twoFactorRequired: true;
  challengeToken: string;
}

interface RequestMeta {
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly twoFactor: TwoFactorService,
    private readonly twoFactorManage: TwoFactorManageService,
    private readonly config: ConfigService,
  ) {}

  private toAuthUser(u: {
    id: string;
    email: string;
    name: string | null;
    image: string | null;
    plan: string;
    admin_role: string | null;
  }): AuthUser {
    return { id: u.id, email: u.email, name: u.name, image: u.image, plan: u.plan, adminRole: u.admin_role };
  }

  /** Phát cặp access + refresh token. Public vì OAuth callback cũng dùng. */
  async issueTokens(user: AuthUser, meta: RequestMeta, opts?: { familyId?: string }): Promise<AuthTokens> {
    const [accessToken, refresh] = await Promise.all([
      this.tokens.signAccessToken(user),
      this.refreshTokens.issue(user.id, { familyId: opts?.familyId, ip: meta.ip, userAgent: meta.userAgent }),
    ]);
    return {
      user,
      accessToken,
      refreshToken: refresh.raw,
      refreshExpiresAt: refresh.expiresAt,
    };
  }

  async signUp(input: { email: string; password: string; name?: string }, meta: RequestMeta): Promise<AuthTokens> {
    const existing = await this.prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
    if (existing) throw new ConflictException({ error: 'Email đã được đăng ký' });

    const hash = await this.passwords.hash(input.password);
    const userId = randomUUID();
    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: { id: userId, email: input.email, name: input.name ?? input.email.split('@')[0] ?? null },
      });
      // account schema theo Better Auth: credential → account_id = userId.
      await tx.account.create({
        data: {
          id: randomUUID(),
          user_id: userId,
          account_id: userId,
          provider_id: CREDENTIAL_PROVIDER,
          password: hash,
        },
      });
      return created;
    });

    return this.issueTokens(this.toAuthUser(user), meta);
  }

  async signIn(input: { email: string; password: string }, meta: RequestMeta): Promise<AuthTokens | TwoFactorChallenge> {
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    const account = user
      ? await this.prisma.account.findFirst({
          where: { user_id: user.id, provider_id: CREDENTIAL_PROVIDER },
          select: { password: true },
        })
      : null;
    // Verify cả khi user không tồn tại (hash giả) → chống timing user-enumeration.
    const ok = await this.passwords.verify(
      account?.password ?? 'deadbeef:deadbeef',
      input.password,
    );
    if (!user || !account?.password || !ok) {
      throw new UnauthorizedException({ error: 'Email hoặc mật khẩu không đúng' });
    }
    if (user.suspended_at) {
      throw new ForbiddenException({ error: 'Tài khoản đã bị tạm khoá' });
    }
    if (user.two_factor_enabled) {
      // Bước 2: client gửi challengeToken + mã TOTP vào /auth/sign-in/2fa.
      return { twoFactorRequired: true, challengeToken: await this.tokens.signChallengeToken(user.id) };
    }

    return this.issueTokens(this.toAuthUser(user), meta);
  }

  async signInTwoFactor(challengeToken: string, code: string, meta: RequestMeta): Promise<AuthTokens> {
    const userId = await this.tokens.verifyChallengeToken(challengeToken);
    if (!userId) throw new UnauthorizedException({ error: 'Phiên 2FA hết hạn — đăng nhập lại' });

    const [user, tf] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId } }),
      this.prisma.two_factor.findFirst({ where: { user_id: userId }, select: { secret: true } }),
    ]);
    if (!user || !tf) throw new UnauthorizedException({ error: 'Phiên 2FA không hợp lệ' });

    const secret = await this.twoFactor.decryptSecret(tf.secret);
    if (!this.twoFactor.verifyTotp(code, secret)) {
      // Fallback backup code (1 lần) — thay authClient.twoFactor.verifyBackupCode cũ.
      const usedBackup = await this.twoFactorManage.consumeBackupCode(userId, code);
      if (!usedBackup) throw new UnauthorizedException({ error: 'Mã 2FA không đúng' });
    }
    return this.issueTokens(this.toAuthUser(user), meta);
  }

  async refresh(rawToken: string, meta: RequestMeta): Promise<AuthTokens> {
    const { userId, next } = await this.refreshTokens.rotate(rawToken, meta);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.suspended_at) {
      await this.refreshTokens.revokeFamily(next.familyId);
      throw new UnauthorizedException({ error: 'Phiên không còn hợp lệ' });
    }
    const accessToken = await this.tokens.signAccessToken(this.toAuthUser(user));
    return {
      user: this.toAuthUser(user),
      accessToken,
      refreshToken: next.raw,
      refreshExpiresAt: next.expiresAt,
    };
  }

  async signOut(rawToken: string | undefined, userId: string | undefined): Promise<void> {
    if (rawToken) await this.refreshTokens.revokeByRaw(rawToken);
    else if (userId) await this.refreshTokens.revokeAllForUser(userId);
  }

  async me(userId: string): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException({ error: 'Unauthorized' });
    return this.toAuthUser(user);
  }

  /**
   * Forgot password — luôn trả OK (không lộ email tồn tại hay không).
   * Email service (Resend) wire ở wave sau — hiện log link ra console dev;
   * non-production trả devToken để test e2e.
   */
  async forgotPassword(email: string): Promise<{ devToken?: string }> {
    const user = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!user) return {};

    const raw = randomBytes(32).toString('base64url');
    await this.prisma.password_reset_token.create({
      data: {
        id: randomUUID(),
        user_id: user.id,
        token_hash: sha256(raw),
        expires_at: new Date(Date.now() + RESET_TTL_MS),
      },
    });
    const appUrl = this.config.get<string>('APP_URL') ?? 'http://localhost:3000';
    this.logger.log(`[reset-password] ${appUrl}/reset-password?token=${raw}`);
    return this.config.get('NODE_ENV') === 'production' ? {} : { devToken: raw };
  }

  /** Reset password — token one-time 1h; xong revoke MỌI refresh token của user. */
  async resetPassword(rawToken: string, newPassword: string): Promise<void> {
    const row = await this.prisma.password_reset_token.findUnique({
      where: { token_hash: sha256(rawToken) },
    });
    if (!row || row.used_at || row.expires_at <= new Date()) {
      throw new UnauthorizedException({ error: 'Link đặt lại mật khẩu không hợp lệ hoặc đã hết hạn' });
    }

    const hash = await this.passwords.hash(newPassword);
    await this.prisma.$transaction(async (tx) => {
      await tx.password_reset_token.update({
        where: { id: row.id },
        data: { used_at: new Date() },
      });
      const account = await tx.account.findFirst({
        where: { user_id: row.user_id, provider_id: CREDENTIAL_PROVIDER },
        select: { id: true },
      });
      if (account) {
        await tx.account.update({ where: { id: account.id }, data: { password: hash, updated_at: new Date() } });
      } else {
        // User OAuth-only đặt mật khẩu lần đầu → tạo credential account.
        await tx.account.create({
          data: {
            id: randomUUID(),
            user_id: row.user_id,
            account_id: row.user_id,
            provider_id: CREDENTIAL_PROVIDER,
            password: hash,
          },
        });
      }
    });
    await this.refreshTokens.revokeAllForUser(row.user_id);
  }
}
