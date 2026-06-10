/**
 * TokenService — JWT của hệ auth mới (plan §3): access token 15 phút, ký
 * ES256 (asymmetric) để gateway/realtime/hocuspocus verify cục bộ bằng public
 * key (JWKS), không round-trip. Keypair từ env (scripts/setup-env.mjs sinh).
 */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  SignJWT,
  calculateJwkThumbprint,
  exportJWK,
  importPKCS8,
  importSPKI,
  jwtVerify,
  type JWK,
  type KeyLike,
} from 'jose';

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
}

@Injectable()
export class TokenService {
  private privateKey?: KeyLike;
  private publicKey?: KeyLike;
  private jwk?: JWK & { kid: string };

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

  /** Public key dạng JWK (kid = RFC 7638 thumbprint) — serve tại /auth/jwks. */
  async getJwks(): Promise<{ keys: JWK[] }> {
    if (!this.jwk) {
      const { publicKey } = await this.keys();
      const jwk = await exportJWK(publicKey);
      const kid = await calculateJwkThumbprint(jwk);
      this.jwk = { ...jwk, kid, alg: ALG, use: 'sig' };
    }
    return { keys: [this.jwk] };
  }

  async signAccessToken(user: AuthUser): Promise<string> {
    const { privateKey } = await this.keys();
    const { keys } = await this.getJwks();
    return new SignJWT({
      email: user.email,
      role: user.adminRole ?? null,
      plan: user.plan ?? null,
    })
      .setProtectedHeader({ alg: ALG, typ: 'JWT', kid: keys[0]?.kid })
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
      };
    } catch {
      return null;
    }
  }
}
