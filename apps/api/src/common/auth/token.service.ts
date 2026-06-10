/**
 * TokenService — JWT của hệ auth MỚI (plan §3): access token 15 phút, ký
 * ES256 (asymmetric) để về sau gateway/realtime/hocuspocus verify cục bộ
 * bằng public key, không round-trip.
 *
 * Keypair đọc từ env (PEM) — Wave 1 chuyển sang bảng jwks + rotation.
 * Refresh token (30d, rotation + reuse-detection) cũng thuộc Wave 1.
 */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SignJWT, jwtVerify, importPKCS8, importSPKI, type KeyLike } from 'jose';

import type { AuthUser } from './session.types';

const ALG = 'ES256';
const ISSUER = 'cogniva';
const AUDIENCE = 'cogniva-app';
const ACCESS_TTL = '15m';

export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: string | null;
  plan: string | null;
  parentalConsentStatus: string | null;
}

@Injectable()
export class TokenService {
  private privateKey?: KeyLike;
  private publicKey?: KeyLike;

  constructor(private readonly config: ConfigService) {}

  private async keys() {
    if (!this.privateKey || !this.publicKey) {
      this.privateKey = await importPKCS8(
        this.config.getOrThrow<string>('AUTH_JWT_PRIVATE_KEY').replace(/\\n/g, '\n'),
        ALG,
      );
      this.publicKey = await importSPKI(
        this.config.getOrThrow<string>('AUTH_JWT_PUBLIC_KEY').replace(/\\n/g, '\n'),
        ALG,
      );
    }
    return { privateKey: this.privateKey, publicKey: this.publicKey };
  }

  async signAccessToken(user: AuthUser): Promise<string> {
    const { privateKey } = await this.keys();
    return new SignJWT({
      email: user.email,
      role: user.adminRole ?? null,
      plan: user.plan ?? null,
      parentalConsentStatus: user.parentalConsentStatus ?? null,
    })
      .setProtectedHeader({ alg: ALG, typ: 'JWT' })
      .setSubject(user.id)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(ACCESS_TTL)
      .sign(privateKey);
  }

  /** Verify chữ ký + iss/aud/exp. Token hỏng/hết hạn → null (caller quyết 401). */
  async verifyAccessToken(token: string): Promise<AccessTokenPayload | null> {
    try {
      const { publicKey } = await this.keys();
      const { payload } = await jwtVerify(token, publicKey, {
        issuer: ISSUER,
        audience: AUDIENCE,
      });
      if (!payload.sub) return null;
      return {
        sub: payload.sub,
        email: String(payload.email ?? ''),
        role: (payload.role as string | null) ?? null,
        plan: (payload.plan as string | null) ?? null,
        parentalConsentStatus: (payload.parentalConsentStatus as string | null) ?? null,
      };
    } catch {
      return null;
    }
  }
}
