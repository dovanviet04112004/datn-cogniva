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
