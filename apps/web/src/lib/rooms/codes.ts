/**
 * Sinh join code 6 ký tự base32 (Crockford-style — không có I/L/O/U gây nhầm).
 *
 * Vì sao không dùng cuid ngắn: code này user gõ tay, cần dễ đọc.
 * Vì sao 6 ký tự: 32^6 = 1.07B combination, đủ unique cho 1k room concurrent.
 *
 * Lưu ý collision: caller phải insert với UNIQUE constraint trên `join_code` →
 * retry nếu DB throw 23505. Probability collision @ 1k rooms = ~10^-6.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';   // bỏ I, L, O, U

export function generateJoinCode(): string {
  let code = '';
  // crypto.getRandomValues — không dùng Math.random (insecure)
  const buf = new Uint32Array(6);
  crypto.getRandomValues(buf);
  for (let i = 0; i < 6; i++) {
    code += ALPHABET[buf[i]! % ALPHABET.length];
  }
  return code;
}
