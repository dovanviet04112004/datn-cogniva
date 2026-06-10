/**
 * Invite code helper — port NGUYÊN từ apps/web/src/lib/group/code.ts
 * (NGUỒN CHUẨN — web còn dùng bản gốc tới khi cutover; đổi alphabet/length
 * thì sửa CẢ HAI). Crockford base32 (bỏ I/L/O/U) 8 ký tự, không case-sensitive
 * khi nhập (normalize uppercase + strip space/dash).
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 8;

/** Sinh invite code random 8 ký tự — crypto.getRandomValues (Node 19+ có global). */
export function generateInviteCode(): string {
  const out: string[] = [];
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(CODE_LENGTH);
    crypto.getRandomValues(bytes);
    for (let i = 0; i < CODE_LENGTH; i++) {
      const b = bytes[i] ?? 0;
      out.push(ALPHABET.charAt(b % ALPHABET.length));
    }
  } else {
    for (let i = 0; i < CODE_LENGTH; i++) {
      out.push(ALPHABET.charAt(Math.floor(Math.random() * ALPHABET.length)));
    }
  }
  return out.join('');
}

/** Chuẩn hoá code user nhập (uppercase + strip space/dash) — "abcd-1234" vẫn match. */
export function normalizeInviteCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, '');
}
