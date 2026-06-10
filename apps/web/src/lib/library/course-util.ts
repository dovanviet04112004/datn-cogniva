/**
 * Course/University helpers (University→Course model, 2026-05-27).
 *
 * slugify tiếng Việt (bỏ dấu) để dedup university/course theo tên. UGC:
 * user gõ tên → autocomplete match slug → reuse hoặc tạo mới.
 */

/** Normalize tên VN → slug ascii để dedup. "Hệ thống nhúng" → "he-thong-nhung". */
export function slugifyVi(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // bỏ dấu combining
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
