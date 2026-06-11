export type SubjectLevel = 'PRIMARY' | 'SECONDARY' | 'HIGH_SCHOOL' | 'UNIVERSITY' | 'ADULT';

export type SubjectDef = {
  slug: string;
  name: string;
  nameEn: string;
  emoji: string;
  levels: SubjectLevel[];
};

export type SubjectCategory = {
  slug: string;
  name: string;
  subjects: SubjectDef[];
};

export const SUBJECT_CATEGORIES: SubjectCategory[] = [
  {
    slug: 'sciences',
    name: 'Khoa học tự nhiên',
    subjects: [
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
    ],
  },
  {
    slug: 'languages',
    name: 'Ngôn ngữ',
    subjects: [
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
    ],
  },
  {
    slug: 'social',
    name: 'Xã hội',
    subjects: [
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
    ],
  },
  {
    slug: 'computing',
    name: 'Tin học & Lập trình',
    subjects: [
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
    ],
  },
  {
    slug: 'arts',
    name: 'Nghệ thuật & Khác',
    subjects: [
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
    ],
  },
];

export const ALL_SUBJECTS: SubjectDef[] = SUBJECT_CATEGORIES.flatMap((c) => c.subjects);

export const SUBJECT_BY_SLUG: Record<string, SubjectDef> = Object.fromEntries(
  ALL_SUBJECTS.map((s) => [s.slug, s]),
);

export function validateSubject(slug: string, level: SubjectLevel): SubjectDef | null {
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

export function expandSubjectSlug(slug: string): string[] {
  return SUBJECT_HIERARCHY[slug] ?? [slug];
}

export const LEVEL_NAMES: Record<SubjectLevel, string> = {
  PRIMARY: 'Tiểu học',
  SECONDARY: 'THCS',
  HIGH_SCHOOL: 'THPT',
  UNIVERSITY: 'Đại học',
  ADULT: 'Người đi làm',
};

export const MODALITY_NAMES: Record<string, string> = {
  ONLINE: 'Online',
  OFFLINE_HN: 'Offline (Hà Nội)',
  OFFLINE_HCM: 'Offline (TP.HCM)',
  HYBRID: 'Online + Offline',
};

export const URGENCY_NAMES: Record<string, string> = {
  ASAP: 'Càng sớm càng tốt',
  THIS_WEEK: 'Trong tuần này',
  THIS_MONTH: 'Trong tháng này',
  FLEXIBLE: 'Linh hoạt',
};
