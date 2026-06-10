/**
 * Sinh mã invite share-friendly cho study group.
 *
 * Format: 8 ký tự base32 (Crockford alphabet không có I/L/O/U để tránh
 * nhầm với 1/0/V). Đủ random cho ~10^12 cases, va đập không lo.
 *
 * Convention:
 *   - Code KHÔNG case-sensitive khi user nhập (toUpperCase trước check)
 *   - Hiển thị uppercase trong UI để dễ đọc khi share
 *
 * Va đập: nếu unique constraint vi phạm, caller retry tối đa 5 lần. Với 32^8
 * = 1.1 nghìn tỉ combo, va đập gần như impossible cho <10M invite.
 */

/** Crockford base32 — loại I, L, O, U để tránh nhầm visual. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 8;

/**
 * Sinh invite code random 8 ký tự.
 * Dùng crypto.getRandomValues khi available (Edge/Node 19+), fallback Math.random.
 */
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

/**
 * Chuẩn hoá code user nhập (uppercase + strip space/dash).
 * Cho phép user dán "abcd-1234" hoặc "abcd 1234" vẫn match.
 */
export function normalizeInviteCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, '');
}
