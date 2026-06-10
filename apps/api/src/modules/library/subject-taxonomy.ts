/**
 * Subject taxonomy — COPY từ packages/db/src/taxonomy-subjects.ts
 * (@cogniva/db là TS-source ESM, api CJS node16 không import được). Đổi
 * taxonomy/hierarchy thì sửa CẢ HAI chỗ.
 */

export type SubjectLevel =
  | 'PRIMARY' // Tiểu học (1-5)
  | 'SECONDARY' // THCS (6-9)
  | 'HIGH_SCHOOL' // THPT (10-12)
  | 'UNIVERSITY' // Đại học / sau đại học
  | 'ADULT'; // Người đi làm / IELTS / chứng chỉ

export type SubjectDef = {
  /** Stable slug — không đổi sau khi data đã reference. */
  slug: string;
  /** Tên tiếng Việt hiển thị UI. */
  name: string;
  /** Tên tiếng Anh để search quốc tế. */
  nameEn: string;
  /** Emoji decorator cho UI card. */
  emoji: string;
  /** Levels phù hợp — filter trong UI khi tutor pick subject. */
  levels: SubjectLevel[];
};

/**
 * Flat list — GIỮ ĐÚNG thứ tự SUBJECT_CATEGORIES.flatMap của bản gốc
 * (sciences → languages → social → computing → arts) vì concierge planner
 * prompt slice(0, 40) theo thứ tự này.
 */
export const ALL_SUBJECTS: SubjectDef[] = [
  // sciences
  {
    slug: 'math',
    name: 'Toán',
    nameEn: 'Mathematics',
    emoji: '📐',
    levels: ['PRIMARY', 'SECONDARY', 'HIGH_SCHOOL', 'UNIVERSITY'],
  },
  {
    slug: 'physics',
    name: 'Vật lý',
    nameEn: 'Physics',
    emoji: '⚛️',
    levels: ['SECONDARY', 'HIGH_SCHOOL', 'UNIVERSITY'],
  },
  {
    slug: 'chemistry',
    name: 'Hóa học',
    nameEn: 'Chemistry',
    emoji: '🧪',
    levels: ['SECONDARY', 'HIGH_SCHOOL', 'UNIVERSITY'],
  },
  {
    slug: 'biology',
    name: 'Sinh học',
    nameEn: 'Biology',
    emoji: '🧬',
    levels: ['SECONDARY', 'HIGH_SCHOOL', 'UNIVERSITY'],
  },
  // languages
  {
    slug: 'english',
    name: 'Tiếng Anh',
    nameEn: 'English',
    emoji: '🇬🇧',
    levels: ['PRIMARY', 'SECONDARY', 'HIGH_SCHOOL', 'UNIVERSITY', 'ADULT'],
  },
  {
    slug: 'english-ielts',
    name: 'IELTS',
    nameEn: 'IELTS',
    emoji: '📝',
    levels: ['HIGH_SCHOOL', 'UNIVERSITY', 'ADULT'],
  },
  {
    slug: 'english-toeic',
    name: 'TOEIC',
    nameEn: 'TOEIC',
    emoji: '📋',
    levels: ['UNIVERSITY', 'ADULT'],
  },
  {
    slug: 'vietnamese',
    name: 'Ngữ văn',
    nameEn: 'Vietnamese Literature',
    emoji: '📚',
    levels: ['PRIMARY', 'SECONDARY', 'HIGH_SCHOOL'],
  },
  {
    slug: 'japanese',
    name: 'Tiếng Nhật',
    nameEn: 'Japanese',
    emoji: '🇯🇵',
    levels: ['SECONDARY', 'HIGH_SCHOOL', 'UNIVERSITY', 'ADULT'],
  },
  {
    slug: 'korean',
    name: 'Tiếng Hàn',
    nameEn: 'Korean',
    emoji: '🇰🇷',
    levels: ['SECONDARY', 'HIGH_SCHOOL', 'UNIVERSITY', 'ADULT'],
  },
  {
    slug: 'chinese',
    name: 'Tiếng Trung',
    nameEn: 'Chinese',
    emoji: '🇨🇳',
    levels: ['SECONDARY', 'HIGH_SCHOOL', 'UNIVERSITY', 'ADULT'],
  },
  // social
  {
    slug: 'history',
    name: 'Lịch sử',
    nameEn: 'History',
    emoji: '🏛️',
    levels: ['SECONDARY', 'HIGH_SCHOOL'],
  },
  {
    slug: 'geography',
    name: 'Địa lý',
    nameEn: 'Geography',
    emoji: '🌍',
    levels: ['SECONDARY', 'HIGH_SCHOOL'],
  },
  {
    slug: 'civics',
    name: 'GDCD / Pháp luật',
    nameEn: 'Civics',
    emoji: '⚖️',
    levels: ['SECONDARY', 'HIGH_SCHOOL'],
  },
  // computing
  {
    slug: 'cs-basics',
    name: 'Tin học cơ bản',
    nameEn: 'Computer Basics',
    emoji: '💻',
    levels: ['PRIMARY', 'SECONDARY', 'HIGH_SCHOOL'],
  },
  {
    slug: 'cs-programming',
    name: 'Lập trình (Python/C/Java)',
    nameEn: 'Programming',
    emoji: '⌨️',
    levels: ['HIGH_SCHOOL', 'UNIVERSITY', 'ADULT'],
  },
  {
    slug: 'cs-web',
    name: 'Web development',
    nameEn: 'Web Development',
    emoji: '🌐',
    levels: ['UNIVERSITY', 'ADULT'],
  },
  {
    slug: 'cs-algorithms',
    name: 'Cấu trúc dữ liệu & giải thuật',
    nameEn: 'Data Structures & Algorithms',
    emoji: '🧮',
    levels: ['UNIVERSITY', 'ADULT'],
  },
  {
    slug: 'cs-ai-ml',
    name: 'AI / Machine Learning',
    nameEn: 'AI & ML',
    emoji: '🤖',
    levels: ['UNIVERSITY', 'ADULT'],
  },
  // arts
  {
    slug: 'music',
    name: 'Âm nhạc',
    nameEn: 'Music',
    emoji: '🎵',
    levels: ['PRIMARY', 'SECONDARY', 'HIGH_SCHOOL', 'ADULT'],
  },
  {
    slug: 'art',
    name: 'Mỹ thuật',
    nameEn: 'Art',
    emoji: '🎨',
    levels: ['PRIMARY', 'SECONDARY', 'HIGH_SCHOOL'],
  },
];

/** Map slug → SubjectDef cho lookup O(1). */
export const SUBJECT_BY_SLUG: Record<string, SubjectDef> = Object.fromEntries(
  ALL_SUBJECTS.map((s) => [s.slug, s]),
);

/** Validate slug + level — return SubjectDef if hợp lệ + level support. */
export function validateSubject(
  slug: string,
  level: SubjectLevel,
): SubjectDef | null {
  const s = SUBJECT_BY_SLUG[slug];
  if (!s) return null;
  if (!s.levels.includes(level)) return null;
  return s;
}

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

/** Vietnamese display name cho level. */
export const LEVEL_NAMES: Record<SubjectLevel, string> = {
  PRIMARY: 'Tiểu học',
  SECONDARY: 'THCS',
  HIGH_SCHOOL: 'THPT',
  UNIVERSITY: 'Đại học',
  ADULT: 'Người đi làm',
};
