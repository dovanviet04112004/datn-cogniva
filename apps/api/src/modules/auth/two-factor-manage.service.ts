import { randomBytes, randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';

import { PasswordService } from '../../common/auth/password.service';
import { PrismaService } from '../../infra/database/prisma.service';
import { TwoFactorService } from './two-factor.service';

const CREDENTIAL_PROVIDER = 'credential';
const SECRET_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function randomString(len: number): string {
  const bytes = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += SECRET_ALPHABET[bytes[i]! % SECRET_ALPHABET.length];
  return out;
}

function base32Encode(input: string): string {
  const data = Buffer.from(input, 'utf8');
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

@Injectable()
export class TwoFactorManageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly twoFactor: TwoFactorService,
  ) {}

  private async verifyPassword(userId: string, password: string): Promise<void> {
    const account = await this.prisma.account.findFirst({
      where: { user_id: userId, provider_id: CREDENTIAL_PROVIDER },
      select: { password: true },
    });
    const ok = await this.passwords.verify(account?.password ?? 'deadbeef:deadbeef', password);
    if (!account?.password || !ok) {
      throw new UnauthorizedException({ error: 'Mật khẩu không đúng' });
    }
  }

  async enable(
    user: { id: string; email: string },
    password: string,
  ): Promise<{ totpURI: string; backupCodes: string[] }> {
    await this.verifyPassword(user.id, password);

    const secret = randomString(32);
    const backupCodes = Array.from({ length: 10 }, () =>
      `${randomString(5)}-${randomString(5)}`.toLowerCase(),
    );
    const [encSecret, encCodes] = await Promise.all([
      this.twoFactor.encryptSecret(secret),
      this.twoFactor.encryptSecret(JSON.stringify(backupCodes)),
    ]);

    await this.prisma.$transaction(async (tx) => {
      await tx.two_factor.deleteMany({ where: { user_id: user.id } });
      await tx.two_factor.create({
        data: {
          id: randomUUID(),
          user_id: user.id,
          secret: encSecret,
          backup_codes: encCodes,
          verified: false,
        },
      });
    });

    const label = encodeURIComponent(`Cogniva:${user.email}`);
    const totpURI = `otpauth://totp/${label}?secret=${base32Encode(secret)}&issuer=Cogniva&digits=6&period=30`;
    return { totpURI, backupCodes };
  }

  async verifyEnable(userId: string, code: string): Promise<void> {
    const tf = await this.prisma.two_factor.findFirst({
      where: { user_id: userId },
      select: { id: true, secret: true },
    });
    if (!tf) throw new BadRequestException({ error: 'Chưa khởi tạo 2FA — gọi enable trước' });

    const secret = await this.twoFactor.decryptSecret(tf.secret);
    if (!this.twoFactor.verifyTotp(code, secret)) {
      throw new UnauthorizedException({ error: 'Mã 2FA không đúng' });
    }
    await this.prisma.$transaction([
      this.prisma.two_factor.update({ where: { id: tf.id }, data: { verified: true } }),
      this.prisma.user.update({ where: { id: userId }, data: { two_factor_enabled: true } }),
    ]);
  }

  async disable(userId: string, password: string): Promise<void> {
    await this.verifyPassword(userId, password);
    await this.prisma.$transaction([
      this.prisma.two_factor.deleteMany({ where: { user_id: userId } }),
      this.prisma.user.update({ where: { id: userId }, data: { two_factor_enabled: false } }),
    ]);
  }

  async consumeBackupCode(userId: string, code: string): Promise<boolean> {
    const tf = await this.prisma.two_factor.findFirst({
      where: { user_id: userId },
      select: { id: true, backup_codes: true },
    });
    if (!tf?.backup_codes) return false;
    let codes: string[];
    try {
      codes = JSON.parse(await this.twoFactor.decryptSecret(tf.backup_codes)) as string[];
    } catch {
      return false;
    }
    const needle = code.trim().toLowerCase();
    if (!codes.includes(needle)) return false;
    const remaining = codes.filter((c) => c !== needle);
    await this.prisma.two_factor.update({
      where: { id: tf.id },
      data: { backup_codes: await this.twoFactor.encryptSecret(JSON.stringify(remaining)) },
    });
    return true;
  }
}
