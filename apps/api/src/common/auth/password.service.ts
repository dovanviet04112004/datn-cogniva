/**
 * PasswordService — hash/verify TƯƠNG THÍCH 2 CHIỀU với Better Auth
 * (@better-auth/utils/password, đã đọc source v1.6.10): scrypt N=16384 r=16
 * p=1 dkLen=64, password NFKC, format `saltHex:keyHex`.
 *
 * Vì sao không argon2: trong cửa sổ dual-stack, account tạo từ flow MỚI vẫn
 * phải đăng nhập được qua Better Auth cũ (và ngược lại) → cùng format là bắt
 * buộc. Đổi thuật toán (nếu muốn) chỉ làm SAU khi gỡ Better Auth.
 */
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

import { Injectable } from '@nestjs/common';

const N = 16384;
const R = 16;
const P = 1;
const DK_LEN = 64;

function deriveKey(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password.normalize('NFKC'),
      salt,
      DK_LEN,
      { N, r: R, p: P, maxmem: 128 * N * R * 2 },
      (err, key) => (err ? reject(err) : resolve(key)),
    );
  });
}

@Injectable()
export class PasswordService {
  async hash(password: string): Promise<string> {
    const salt = randomBytes(16).toString('hex');
    const key = await deriveKey(password, salt);
    return `${salt}:${key.toString('hex')}`;
  }

  async verify(hash: string, password: string): Promise<boolean> {
    const [salt, keyHex] = hash.split(':');
    if (!salt || !keyHex) return false;
    const expected = Buffer.from(keyHex, 'hex');
    const actual = await deriveKey(password, salt);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }
}
