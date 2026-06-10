/**
 * Subject hierarchy expansion — COPY từ packages/db/src/taxonomy-subjects.ts
 * (@cogniva/db là TS-source ESM, api CJS node16 không import được). Đổi
 * hierarchy thì sửa CẢ HAI chỗ.
 */
const SUBJECT_HIERARCHY: Record<string, string[]> = {
  english: ['english', 'english-ielts', 'english-toeic'],
  'cs-programming': ['cs-programming', 'cs-algorithms', 'cs-web-dev', 'cs-mobile-dev'],
  math: ['math', 'math-olympiad'],
};

/**
 * Expand parent slug thành mảng con + self. Return [slug] nếu không có hierarchy.
 * Vô danh slug (không tồn tại) → return [slug] (caller tự xử lý empty result).
 */
export function expandSubjectSlug(slug: string): string[] {
  return SUBJECT_HIERARCHY[slug] ?? [slug];
}
