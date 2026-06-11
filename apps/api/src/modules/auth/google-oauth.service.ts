import { randomUUID } from 'node:crypto';

import { Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRemoteJWKSet, jwtVerify } from 'jose';

import { PrismaService } from '../../infra/database/prisma.service';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const PROVIDER = 'google';

export interface GoogleProfile {
  sub: string;
  email: string;
  name: string | null;
  picture: string | null;
}

@Injectable()
export class GoogleOauthService {
  private jwks?: ReturnType<typeof createRemoteJWKSet>;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  isConfigured(): boolean {
    return !!this.config.get('GOOGLE_CLIENT_ID') && !!this.config.get('GOOGLE_CLIENT_SECRET');
  }

  private requireConfig() {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException({ error: 'Google OAuth chưa được cấu hình' });
    }
  }

  private redirectUri(): string {
    return `${this.config.get<string>('APP_URL')}/api/auth/google/callback`;
  }

  buildAuthUrl(state: string): string {
    this.requireConfig();
    const params = new URLSearchParams({
      client_id: this.config.getOrThrow<string>('GOOGLE_CLIENT_ID'),
      redirect_uri: this.redirectUri(),
      response_type: 'code',
      scope: 'openid email profile',
      state,
      prompt: 'select_account',
    });
    return `${AUTH_URL}?${params}`;
  }

  async exchangeCode(code: string): Promise<GoogleProfile> {
    this.requireConfig();
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: this.config.getOrThrow<string>('GOOGLE_CLIENT_ID'),
        client_secret: this.config.getOrThrow<string>('GOOGLE_CLIENT_SECRET'),
        redirect_uri: this.redirectUri(),
        grant_type: 'authorization_code',
      }),
    });
    if (!res.ok) throw new UnauthorizedException({ error: 'Đổi mã Google thất bại' });
    const { id_token } = (await res.json()) as { id_token?: string };
    if (!id_token) throw new UnauthorizedException({ error: 'Google không trả id_token' });

    this.jwks ??= createRemoteJWKSet(new URL(JWKS_URL));
    const { payload } = await jwtVerify(id_token, this.jwks, {
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      audience: this.config.getOrThrow<string>('GOOGLE_CLIENT_ID'),
    });
    if (!payload.sub || !payload.email || payload.email_verified !== true) {
      throw new UnauthorizedException({ error: 'Tài khoản Google không hợp lệ' });
    }
    return {
      sub: payload.sub,
      email: String(payload.email).toLowerCase(),
      name: (payload.name as string | undefined) ?? null,
      picture: (payload.picture as string | undefined) ?? null,
    };
  }

  async upsertUser(profile: GoogleProfile) {
    const linked = await this.prisma.account.findFirst({
      where: { provider_id: PROVIDER, account_id: profile.sub },
      select: { user_id: true },
    });
    if (linked) {
      const user = await this.prisma.user.findUnique({ where: { id: linked.user_id } });
      if (user) return user;
    }

    const byEmail = await this.prisma.user.findUnique({ where: { email: profile.email } });
    if (byEmail) {
      if (!linked) {
        await this.prisma.account.create({
          data: {
            id: randomUUID(),
            user_id: byEmail.id,
            account_id: profile.sub,
            provider_id: PROVIDER,
          },
        });
      }
      return byEmail;
    }

    const userId = randomUUID();
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          id: userId,
          email: profile.email,
          name: profile.name,
          image: profile.picture,
          email_verified: true,
        },
      });
      await tx.account.create({
        data: { id: randomUUID(), user_id: userId, account_id: profile.sub, provider_id: PROVIDER },
      });
      return user;
    });
  }
}
