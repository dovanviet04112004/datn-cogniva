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
const CHALLENGE_AUDIENCE = 'cogniva-2fa';
const CHALLENGE_TTL = '5m';

export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: string | null;
  plan: string | null;
  name: string | null;
  picture: string | null;
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
      name: user.name ?? null,
      picture: user.image ?? null,
    })
      .setProtectedHeader({ alg: ALG, typ: 'JWT', kid: keys[0]?.kid })
      .setSubject(user.id)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(ACCESS_TTL)
      .sign(privateKey);
  }

  async signChallengeToken(userId: string): Promise<string> {
    const { privateKey } = await this.keys();
    return new SignJWT({})
      .setProtectedHeader({ alg: ALG, typ: 'JWT' })
      .setSubject(userId)
      .setIssuer(ISSUER)
      .setAudience(CHALLENGE_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(CHALLENGE_TTL)
      .sign(privateKey);
  }

  async verifyChallengeToken(token: string): Promise<string | null> {
    try {
      const { publicKey } = await this.keys();
      const { payload } = await jwtVerify(token, publicKey, {
        issuer: ISSUER,
        audience: CHALLENGE_AUDIENCE,
      });
      return payload.sub ?? null;
    } catch {
      return null;
    }
  }

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
        name: typeof payload.name === 'string' ? payload.name : null,
        picture: typeof payload.picture === 'string' ? payload.picture : null,
      };
    } catch {
      return null;
    }
  }
}
