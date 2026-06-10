/**
 * TwoFactorService — verify TOTP TƯƠNG THÍCH dữ liệu Better Auth twoFactor
 * plugin (đã đọc source v1.6.10):
 *  - secret lưu DB = XChaCha20-Poly1305(key = SHA-256(BETTER_AUTH_SECRET)),
 *    hex, nonce 24B prepend (managedNonce), có thể bọc envelope `$ba$<v>$`.
 *  - TOTP: HMAC-SHA1 trên secret utf8, 6 số, period 30s, window ±1.
 * Quản lý enable/disable vẫn ở flow cũ tới khi gỡ Better Auth — service này
 * chỉ phục vụ bước verify lúc đăng nhập (parity sign-in).
 */
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

  /** Giải mã secret từ DB (envelope `$ba$v$hex` hoặc hex trần legacy). */
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

  /** Mã hoá secret theo đúng format Better Auth (dùng cho test + enable sau này). */
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
