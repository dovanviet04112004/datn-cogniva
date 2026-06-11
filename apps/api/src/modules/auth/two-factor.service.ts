import { createHash, createHmac } from 'node:crypto';

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const ENVELOPE_PREFIX = '$ba$';
const DIGITS = 6;
const PERIOD_S = 30;
const WINDOW = 1;

@Injectable()
export class TwoFactorService {
  constructor(private readonly config: ConfigService) {}

  async decryptSecret(stored: string): Promise<string> {
    let hex = stored;
    if (stored.startsWith(ENVELOPE_PREFIX)) {
      const sep = stored.indexOf('$', ENVELOPE_PREFIX.length);
      if (sep === -1) throw new UnauthorizedException({ error: 'Dữ liệu 2FA không hợp lệ' });
      hex = stored.slice(sep + 1);
    }
    const [{ xchacha20poly1305 }, { managedNonce }] = await Promise.all([
      import('@noble/ciphers/chacha.js'),
      import('@noble/ciphers/utils.js'),
    ]);
    const key = createHash('sha256')
      .update(this.config.getOrThrow<string>('BETTER_AUTH_SECRET'))
      .digest();
    const plaintext = managedNonce(xchacha20poly1305)(new Uint8Array(key)).decrypt(
      Uint8Array.from(Buffer.from(hex, 'hex')),
    );
    return Buffer.from(plaintext).toString('utf8');
  }

  async encryptSecret(secret: string): Promise<string> {
    const [{ xchacha20poly1305 }, { managedNonce }] = await Promise.all([
      import('@noble/ciphers/chacha.js'),
      import('@noble/ciphers/utils.js'),
    ]);
    const key = createHash('sha256')
      .update(this.config.getOrThrow<string>('BETTER_AUTH_SECRET'))
      .digest();
    const ciphertext = managedNonce(xchacha20poly1305)(new Uint8Array(key)).encrypt(
      Uint8Array.from(Buffer.from(secret, 'utf8')),
    );
    return Buffer.from(ciphertext).toString('hex');
  }

  verifyTotp(code: string, secret: string): boolean {
    const counter = Math.floor(Date.now() / (PERIOD_S * 1000));
    for (let i = -WINDOW; i <= WINDOW; i++) {
      if (this.hotp(secret, counter + i) === code) return true;
    }
    return false;
  }

  private hotp(secret: string, counter: number): string {
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64BE(BigInt(counter));
    const mac = createHmac('sha1', secret).update(buf).digest();
    const offset = (mac[mac.length - 1] ?? 0) & 15;
    const truncated =
      (((mac[offset] ?? 0) & 127) << 24) |
      (((mac[offset + 1] ?? 0) & 255) << 16) |
      (((mac[offset + 2] ?? 0) & 255) << 8) |
      ((mac[offset + 3] ?? 0) & 255);
    return (truncated % 10 ** DIGITS).toString().padStart(DIGITS, '0');
  }
}
