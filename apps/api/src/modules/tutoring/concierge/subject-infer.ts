/**
 * subject-infer — port nguyên văn từ apps/web/src/lib/tutoring/subject-infer.ts.
 *
 * Deterministic mapping từ user-typed Vietnamese text → subject slug.
 * Dùng để override planner LLM khi nó không follow rule "có subject thì search".
 *
 * Pattern: nếu user message chứa keyword môn → trả slug. Backup cho planner
 * model nhỏ có lúc trả clarify dù đã có subject (rule-following không 100%).
 */

/** Vietnamese keyword → subject slug map. Order matters: specific trước (ielts trước english). */
const SUBJECT_KEYWORDS: Array<{ slug: string; patterns: RegExp[] }> = [
  {
    slug: 'english-ielts',
    patterns: [/\bielts\b/i, /\baca\s*ielts\b/i],
  },
  {
    slug: 'english-toeic',
    patterns: [/\btoeic\b/i],
  },
  {
    slug: 'english',
    patterns: [
      /tiếng\s*anh/i,
      /tieng\s*anh/i,
      /\benglish\b/i,
      /\banh\s+văn\b/i,
      /giao\s*tiếp/i, // "tiếng Anh giao tiếp"
    ],
  },
  {
    slug: 'math',
    patterns: [
      /\btoán\b/i,
      /\btoan\b/i,
      /\bmath\b/i,
      /\bgiải\s*tích\b/i,
      /\bđại\s*số\b/i,
      /\bhình\s*học\b/i,
    ],
  },
  {
    slug: 'physics',
    patterns: [/\bvật\s*lý\b/i, /\bvat\s*ly\b/i, /\blý\b/i, /\bphysics\b/i],
  },
  {
    slug: 'chemistry',
    patterns: [/\bhoá\b/i, /\bhóa\b/i, /\bhoa\s*hoc\b/i, /\bchemistry\b/i],
  },
  {
    slug: 'biology',
    patterns: [/\bsinh\s*học\b/i, /\bbiology\b/i],
  },
  {
    slug: 'literature',
    patterns: [/\bvăn\b/i, /\bngữ\s*văn\b/i, /\bvan\b/i, /\bliterature\b/i],
  },
  {
    slug: 'history',
    patterns: [/\blịch\s*sử\b/i, /\bsử\b/i, /\bhistory\b/i],
  },
  {
    slug: 'geography',
    patterns: [/\bđịa\s*lý\b/i, /\bđịa\b/i, /\bgeography\b/i],
  },
  {
    slug: 'cs-algorithms',
    patterns: [/giải\s*thuật/i, /thuật\s*toán/i, /algorithm/i],
  },
  {
    slug: 'cs-programming',
    patterns: [
      /lập\s*trình/i,
      /\bpython\b/i,
      /\bjavascript\b/i,
      /\bjava\b/i,
      /\bc\+\+/i,
      /\bgo\s*lang\b/i,
      /\bcode\b/i,
      /\bcoding\b/i,
    ],
  },
  {
    slug: 'japanese',
    patterns: [/tiếng\s*nhật/i, /\bjapanese\b/i, /\bjlpt\b/i, /\bn[1-5]\b/i],
  },
  {
    slug: 'korean',
    patterns: [/tiếng\s*hàn/i, /\bkorean\b/i, /\btopik\b/i],
  },
  {
    slug: 'chinese',
    patterns: [/tiếng\s*trung/i, /\bchinese\b/i, /\bhsk\b/i],
  },
];

/** Map text → subject slug nếu match. Trả null nếu không match. */
export function inferSubjectFromText(text: string): string | null {
  if (!text) return null;
  const t = text.normalize('NFC');
  for (const { slug, patterns } of SUBJECT_KEYWORDS) {
    for (const p of patterns) {
      if (p.test(t)) return slug;
    }
  }
  return null;
}

/**
 * Vietnamese level keyword → SubjectLevel.
 *   "lớp 1-5" → PRIMARY
 *   "lớp 6-9", "THCS" → SECONDARY
 *   "lớp 10-12", "THPT" → HIGH_SCHOOL
 *   "đại học" → UNIVERSITY
 *   "đi làm", "IELTS", "TOEIC" → ADULT
 */
export function inferLevelFromText(text: string): string | null {
  if (!text) return null;
  const t = text.toLowerCase();
  // Match "lớp 1-5" / "lớp 12" / etc.
  const m = t.match(/lớp\s*(\d{1,2})/);
  if (m) {
    const grade = parseInt(m[1] ?? '0', 10);
    if (grade >= 1 && grade <= 5) return 'PRIMARY';
    if (grade >= 6 && grade <= 9) return 'SECONDARY';
    if (grade >= 10 && grade <= 12) return 'HIGH_SCHOOL';
  }
  if (/tiểu\s*học/.test(t) || /\bprimary\b/i.test(t)) return 'PRIMARY';
  if (/\bthcs\b/i.test(t) || /cấp\s*2/i.test(t) || /trung\s*học\s*cơ\s*sở/i.test(t))
    return 'SECONDARY';
  if (/\bthpt\b/i.test(t) || /cấp\s*3/i.test(t) || /trung\s*học\s*phổ\s*thông/i.test(t))
    return 'HIGH_SCHOOL';
  if (/đại\s*học/.test(t) || /\bsinh\s*viên\b/i.test(t) || /\bdh\b/i.test(t))
    return 'UNIVERSITY';
  if (/người\s*lớn/.test(t) || /đi\s*làm/.test(t) || /\bielts\b/i.test(t) || /\btoeic\b/i.test(t))
    return 'ADULT';
  return null;
}
