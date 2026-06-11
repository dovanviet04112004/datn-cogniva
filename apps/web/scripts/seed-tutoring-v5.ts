import { randomUUID } from 'node:crypto';
import { eq, inArray, like } from 'drizzle-orm';
import {
  db,
  tutorAvailability,
  tutorProfile,
  tutorRequest,
  tutorReview,
  tutorSubject,
  tutoringBooking,
  user,
} from '@cogniva/db';

import { embedQuery } from '../src/lib/ingest/embed-query';

const SEED_SUFFIX = '@seed-v5.cogniva.local';
const STUDENT_SUFFIX = '@seed-v5-student.cogniva.local';

const RESET = process.argv.includes('--reset');
const NO_EMBED = process.argv.includes('--no-embed');

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}
function pickN<T>(arr: T[], n: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}
function rand(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function normal(mean: number, std: number): number {
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + z * std;
}
function maybe(p: number): boolean {
  return Math.random() < p;
}
function slugify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

const VN_FIRST_NAMES = [
  'Mai',
  'Linh',
  'Hà',
  'Trang',
  'Hương',
  'Lan',
  'Hoa',
  'Thảo',
  'Trinh',
  'Nhung',
  'An',
  'Bình',
  'Cường',
  'Dũng',
  'Đức',
  'Hải',
  'Hùng',
  'Khôi',
  'Long',
  'Minh',
  'Nam',
  'Phong',
  'Quân',
  'Sơn',
  'Tài',
  'Thành',
  'Tuấn',
  'Việt',
  'Vũ',
  'Đạt',
  'Khánh',
  'Khoa',
  'Hiếu',
  'Bảo',
  'Phú',
  'Nghĩa',
  'Anh',
  'Tâm',
  'Hà My',
  'Mỹ Linh',
  'Phương',
  'Quỳnh',
  'Thuỳ',
  'Ngọc',
  'Diệu',
  'Yến',
  'Huyền',
  'Châu',
  'Vy',
  'Chi',
];
const VN_LAST_NAMES = [
  'Nguyễn',
  'Trần',
  'Lê',
  'Phạm',
  'Hoàng',
  'Huỳnh',
  'Phan',
  'Vũ',
  'Võ',
  'Đặng',
  'Bùi',
  'Đỗ',
  'Hồ',
  'Ngô',
  'Dương',
  'Lý',
  'Đinh',
  'Trịnh',
  'Đoàn',
  'Cao',
];
const VN_MIDDLE_NAMES = [
  'Thị',
  'Văn',
  'Hồng',
  'Quốc',
  'Minh',
  'Đức',
  'Thanh',
  'Mai',
  'Anh',
  'Tuấn',
  'Hữu',
  'Hoàng',
  'Bảo',
  'Gia',
  'Khánh',
  'Ngọc',
  '',
];

function genName(): string {
  const last = pick(VN_LAST_NAMES);
  const middle = pick(VN_MIDDLE_NAMES);
  const first = pick(VN_FIRST_NAMES);
  return middle ? `${last} ${middle} ${first}` : `${last} ${first}`;
}

type SubjectSpec = {
  slug: string;
  name: string;
  bioTemplates: string[];
  headlineTemplates: string[];
  requestTitles: string[];
  requestDescTemplates: string[];
  levels: Array<'PRIMARY' | 'SECONDARY' | 'HIGH_SCHOOL' | 'UNIVERSITY' | 'ADULT'>;
  weight: number;
};

const SUBJECTS: SubjectSpec[] = [
  {
    slug: 'math',
    name: 'Toán',
    weight: 25,
    levels: ['PRIMARY', 'SECONDARY', 'HIGH_SCHOOL', 'UNIVERSITY'],
    bioTemplates: [
      'Tốt nghiệp Sư phạm Toán, {years} năm kinh nghiệm dạy {levelName}. Học sinh đạt {percent}% điểm 8+ trong kỳ thi gần nhất. Phương pháp chia nhỏ chương trình theo dạng bài, luyện đề có chấm điểm tự động.',
      '{years} năm dạy Toán {levelName} 1-1 + nhóm nhỏ. Chuyên {topic}. Cam kết nâng {points} điểm sau {weeks} tuần với học sinh chăm chỉ. Hỗ trợ giải bài tập 24/7 qua Zalo.',
      'Cựu sinh viên ĐH Bách Khoa Toán-Tin. {years} năm gia sư Toán {levelName}. Hệ thống lý thuyết → dạng bài → đề thi thử. Trải nghiệm với {students}+ học sinh đã lên chuyên ngành.',
    ],
    headlineTemplates: [
      'Gia sư Toán {levelName} — {years} năm kinh nghiệm luyện thi',
      'Toán {levelName} — chuyên {topic}, cam kết tiến bộ rõ rệt',
      'Gia sư Toán {levelName} — phương pháp dễ hiểu, luyện đề bám sát',
    ],
    requestTitles: [
      'Cần gia sư Toán {levelName} kèm 1-1',
      'Tìm gia sư Toán {levelName} luyện thi',
      'Học sinh {levelName} cần kèm Toán {topic}',
    ],
    requestDescTemplates: [
      'Mình đang học lớp {grade}, hổng kiến thức {topic}. Cần gia sư kèm 1-1 {sessions} buổi/tuần, mục tiêu lên {targetScore} điểm trong vòng {weeks} tuần. Có thể học online hoặc tại nhà (quận {district}).',
      'Con mình lớp {grade}, môn Toán bị mất gốc phần {topic}. Cần thầy/cô có kinh nghiệm dạy chậm, kiên nhẫn. Ưu tiên gia sư đã từng kèm học sinh tương tự.',
      'Cần luyện đề Toán {levelName} chuẩn bị thi {examName}. Yêu cầu: chữa bài chi tiết, có hệ thống dạng bài, feedback từng buổi.',
    ],
  },
  {
    slug: 'physics',
    name: 'Vật lý',
    weight: 10,
    levels: ['SECONDARY', 'HIGH_SCHOOL', 'UNIVERSITY'],
    bioTemplates: [
      'Tốt nghiệp ĐH Sư phạm Vật lý, {years} năm dạy Lý {levelName}. Chuyên giải bài tập theo phương pháp hiện đại, gắn lý thuyết với thực tế. Học sinh trung bình nâng {points} điểm/học kỳ.',
      'Cựu học sinh trường chuyên Lý, hiện là giảng viên ĐH. {years} năm gia sư Vật lý {levelName}. Dạy chậm cho học sinh mất gốc, dạy nhanh cho học sinh muốn nâng cao.',
    ],
    headlineTemplates: [
      'Gia sư Vật Lý {levelName} — chuyên dạy {topic}',
      'Lý {levelName} — {years} năm kinh nghiệm, ôn thi đại học',
    ],
    requestTitles: ['Cần gia sư Vật Lý {levelName}', 'Tìm thầy/cô Lý {levelName} kèm 1-1'],
    requestDescTemplates: [
      'Học sinh lớp {grade} cần ôn lại Lý phần {topic}. Mục tiêu: nắm chắc lý thuyết + làm tốt bài tập trắc nghiệm. {sessions} buổi/tuần.',
      'Cần gia sư Lý giúp con luyện đề thi đại học khối A. Lực học hiện tại: trung bình. Mong tăng lên 7-8 điểm thi thử trong {weeks} tuần.',
    ],
  },
  {
    slug: 'chemistry',
    name: 'Hoá học',
    weight: 8,
    levels: ['SECONDARY', 'HIGH_SCHOOL'],
    bioTemplates: [
      'Cử nhân Hoá học ĐH Khoa Học Tự Nhiên, {years} năm dạy Hoá {levelName}. Phương pháp: sơ đồ tư duy + công thức nhanh + luyện đề trắc nghiệm.',
      '{years} năm kinh nghiệm dạy Hoá. Chuyên giải bài tập nâng cao + ôn thi {examName}. Học sinh đậu trường chuyên năm gần nhất {students} em.',
    ],
    headlineTemplates: [
      'Gia sư Hoá {levelName} — phương pháp giải bài tập nhanh',
      'Hoá học {levelName} — luyện thi {examName}',
    ],
    requestTitles: ['Tìm gia sư Hoá {levelName}', 'Cần kèm Hoá {topic}'],
    requestDescTemplates: [
      'Cần gia sư Hoá kèm con lớp {grade}, đặc biệt phần {topic}. Hiện đang yếu, mất gốc, cần dạy lại từ cơ bản.',
      'Học sinh THPT chuẩn bị thi đại học, cần luyện đề Hoá {sessions} buổi/tuần. Mục tiêu 8+ điểm.',
    ],
  },
  {
    slug: 'literature',
    name: 'Văn',
    weight: 5,
    levels: ['SECONDARY', 'HIGH_SCHOOL'],
    bioTemplates: [
      'Tốt nghiệp Sư phạm Văn, {years} năm dạy Văn {levelName}. Phong cách: bám sát đề thi, dạy lập dàn ý + viết mở bài hay, sử dụng dẫn chứng văn học mới mẻ.',
      'Giáo viên Văn cấp THPT, từng có học sinh đạt điểm 9 thi đại học. {years} năm gia sư Văn.',
    ],
    headlineTemplates: [
      'Gia sư Văn {levelName} — luyện viết mở bài hay, kết bài chốt mạnh',
      'Văn {levelName} — chuyên dạy nghị luận xã hội',
    ],
    requestTitles: ['Cần gia sư Văn {levelName}', 'Tìm cô kèm Văn {topic}'],
    requestDescTemplates: [
      'Con đang học lớp {grade}, Văn yếu phần nghị luận. Cần cô dạy cách lập dàn ý + viết mở bài.',
      'Học sinh THPT cần luyện thi tốt nghiệp môn Văn. {sessions} buổi/tuần, mục tiêu 7+ điểm.',
    ],
  },
  {
    slug: 'english',
    name: 'Tiếng Anh',
    weight: 12,
    levels: ['PRIMARY', 'SECONDARY', 'HIGH_SCHOOL', 'UNIVERSITY', 'ADULT'],
    bioTemplates: [
      '{years} năm dạy Tiếng Anh {levelName}. TOEFL/IELTS {score}, từng học/làm ở {country}. Phương pháp: focus speaking + listening, dạy theo chủ đề thực tế (job interview, travel, business).',
      'Tốt nghiệp ngành Sư phạm Tiếng Anh, {years} năm kinh nghiệm. Chuyên ngữ pháp + writing essay {levelName}. Học sinh trung bình lên {points} band trong {weeks} tuần.',
    ],
    headlineTemplates: [
      'Gia sư Tiếng Anh {levelName} — focus speaking + listening',
      'English {levelName} — luyện ngữ pháp + viết essay',
    ],
    requestTitles: ['Cần gia sư Tiếng Anh giao tiếp', 'Tìm cô dạy English {levelName}'],
    requestDescTemplates: [
      'Mình {age} tuổi, muốn cải thiện Tiếng Anh giao tiếp công sở. Tập trung speaking + listening. {sessions} buổi/tuần, có thể học online.',
      'Cần gia sư kèm con lớp {grade} môn Tiếng Anh. Đặc biệt ngữ pháp + viết essay. Hiện học sinh điểm trung bình ~{currentScore}.',
    ],
  },
  {
    slug: 'english-ielts',
    name: 'IELTS',
    weight: 12,
    levels: ['HIGH_SCHOOL', 'UNIVERSITY', 'ADULT'],
    bioTemplates: [
      'IELTS overall {ieltsBand} (Speaking {speakingBand}, Writing {writingBand}). {years} năm dạy IELTS cho ~{students} học viên, average tăng {bandDelta} band trong {months} tháng. Format: 70% practice + correction cá nhân hoá, 30% strategy.',
      'Cựu du học sinh {country}, IELTS {ieltsBand}. Chuyên dạy luyện đề IELTS Academic + General. Có Notion template + audio practice riêng cho học viên.',
    ],
    headlineTemplates: [
      'IELTS {ieltsBand} — chuyên luyện band {targetBand}+ cho người đi làm',
      'Gia sư IELTS {targetBand}+ — Speaking & Writing strategy',
    ],
    requestTitles: [
      'Cần gia sư IELTS target {targetBand}',
      'Tìm tutor luyện IELTS Speaking & Writing',
    ],
    requestDescTemplates: [
      'Mình đang ở band {currentBand}, mục tiêu {targetBand} trong {months} tháng. Cần focus {focusSkill}. Lịch học: {sessions} buổi/tuần, online.',
      'Cần tutor IELTS có kinh nghiệm chấm essay + speaking mock. Hiện band {currentBand}, muốn lên {targetBand} để apply học bổng {country}.',
    ],
  },
  {
    slug: 'english-toeic',
    name: 'TOEIC',
    weight: 6,
    levels: ['UNIVERSITY', 'ADULT'],
    bioTemplates: [
      'TOEIC {toeicScore}/990. {years} năm dạy TOEIC cho sinh viên + người đi làm. Học viên trung bình lên {scoreDelta} điểm sau {weeks} tuần. Tài liệu: ETS official + đề thi thật.',
      'Chuyên luyện TOEIC cho dân ngân hàng, IT, marketing. {years} năm. Phương pháp: phân tích từng dạng bài + mẹo time management.',
    ],
    headlineTemplates: [
      'TOEIC {toeicScore} — luyện thi {targetScore}+ cho người đi làm',
      'Gia sư TOEIC — chuyên Listening & Reading strategy',
    ],
    requestTitles: ['Cần gia sư TOEIC target {targetScore}', 'Tìm tutor luyện TOEIC nhanh'],
    requestDescTemplates: [
      'Mình cần đạt TOEIC {targetScore} để ra trường, hiện ~{currentScore}. Còn {weeks} tuần. Học online, {sessions} buổi/tuần.',
      'Cần gia sư TOEIC chuyên luyện part 5-7 (reading). Mục tiêu {targetScore}+, hiện được ~{currentScore}.',
    ],
  },
  {
    slug: 'cs-programming',
    name: 'Lập trình',
    weight: 10,
    levels: ['SECONDARY', 'HIGH_SCHOOL', 'UNIVERSITY', 'ADULT'],
    bioTemplates: [
      'Software engineer {years} năm kinh nghiệm tại {company}. Dạy lập trình {lang} cho người mới + sinh viên CNTT. Phong cách: code thật + project-based learning, không sa đà lý thuyết.',
      'Cựu sinh viên Bách Khoa CNTT, hiện làm {role}. {years} năm dạy lập trình {lang}. Học viên có thể build đủ skill phỏng vấn entry-level sau {months} tháng.',
    ],
    headlineTemplates: [
      'Lập trình {lang} — project-based, sẵn sàng phỏng vấn',
      'Gia sư lập trình {lang} cho người mới + sinh viên CNTT',
    ],
    requestTitles: ['Cần gia sư lập trình {lang}', 'Tìm tutor học {lang} cho người mới'],
    requestDescTemplates: [
      'Mình mới chuyển sang IT, muốn học {lang} từ zero. Mục tiêu: làm được {project} cơ bản sau {months} tháng. {sessions} buổi/tuần, online.',
      'Sinh viên năm 2 CNTT cần kèm môn {lang} + cấu trúc dữ liệu. Mức điểm hiện tại: 6-7, mong lên 8+.',
    ],
  },
  {
    slug: 'japanese',
    name: 'Tiếng Nhật',
    weight: 4,
    levels: ['HIGH_SCHOOL', 'UNIVERSITY', 'ADULT'],
    bioTemplates: [
      'JLPT {jlptLevel}, {years} năm dạy Tiếng Nhật. Cựu du học sinh Tokyo. Dạy giao tiếp + ngữ pháp + chuẩn bị JLPT.',
      'Tốt nghiệp Khoa Đông phương ĐH KHXH&NV, JLPT {jlptLevel}. {years} năm gia sư.',
    ],
    headlineTemplates: [
      'Tiếng Nhật {jlptLevel} — du học sinh Tokyo, dạy giao tiếp + JLPT',
      'Gia sư Tiếng Nhật — chuyên ngữ pháp + kanji',
    ],
    requestTitles: ['Cần gia sư Tiếng Nhật {jlptLevel}', 'Tìm tutor học Tiếng Nhật cơ bản'],
    requestDescTemplates: [
      'Mình mới học Tiếng Nhật, target JLPT {jlptLevel}. {sessions} buổi/tuần, online.',
    ],
  },
];

const TOPICS_BY_SUBJECT: Record<string, string[]> = {
  math: ['hàm số', 'hình học không gian', 'tích phân', 'số phức', 'lượng giác', 'xác suất'],
  physics: ['cơ học', 'điện học', 'sóng', 'nhiệt động', 'quang học'],
  chemistry: ['hữu cơ', 'vô cơ', 'điện phân', 'cân bằng phản ứng'],
  literature: ['nghị luận xã hội', 'phân tích thơ', 'phân tích tác phẩm văn xuôi'],
  english: ['conversation', 'grammar', 'business English'],
  'english-ielts': ['Speaking', 'Writing Task 2', 'Reading'],
  'english-toeic': ['Listening', 'Reading'],
  'cs-programming': ['Python', 'JavaScript', 'Java', 'C++'],
  japanese: ['ngữ pháp N5', 'kanji', 'giao tiếp'],
};

const EXAMS_BY_SUBJECT: Record<string, string[]> = {
  math: ['tốt nghiệp THPT', 'đánh giá năng lực', 'học sinh giỏi'],
  physics: ['tốt nghiệp THPT', 'khối A'],
  chemistry: ['tốt nghiệp THPT', 'khối B', 'học sinh giỏi'],
  literature: ['tốt nghiệp THPT', 'khối D'],
  english: ['tốt nghiệp THPT', 'khối D'],
  'english-ielts': ['IELTS Academic', 'IELTS General'],
  'english-toeic': ['TOEIC'],
  'cs-programming': ['kỳ thi giữa kỳ', 'phỏng vấn intern'],
  japanese: ['JLPT N5', 'JLPT N4', 'JLPT N3'],
};

const LEVEL_NAMES: Record<string, string> = {
  PRIMARY: 'Tiểu học',
  SECONDARY: 'THCS',
  HIGH_SCHOOL: 'THPT',
  UNIVERSITY: 'Đại học',
  ADULT: 'Người đi làm',
};

const DISTRICTS = [
  'Cầu Giấy',
  'Đống Đa',
  'Hai Bà Trưng',
  'Hoàng Mai',
  'Thanh Xuân',
  '1',
  '3',
  '5',
  '7',
  '10',
];
const COMPANIES = ['FPT Software', 'VinAI', 'Tiki', 'MoMo', 'VNG', 'Shopee', 'Grab', 'Be'];
const COUNTRIES = ['Anh', 'Úc', 'Mỹ', 'Canada', 'Nhật', 'New Zealand'];

function fillTemplate(tmpl: string, sub: SubjectSpec, level: string): string {
  const topic = pick(TOPICS_BY_SUBJECT[sub.slug] ?? ['phần khó']);
  const exam = pick(EXAMS_BY_SUBJECT[sub.slug] ?? ['kỳ thi sắp tới']);
  const gradeMap: Record<string, () => number> = {
    PRIMARY: () => rand(1, 5),
    SECONDARY: () => rand(6, 9),
    HIGH_SCHOOL: () => rand(10, 12),
    UNIVERSITY: () => rand(1, 4),
    ADULT: () => 0,
  };
  return tmpl
    .replace(/{years}/g, String(rand(2, 12)))
    .replace(/{months}/g, String(rand(2, 12)))
    .replace(/{weeks}/g, String(rand(4, 16)))
    .replace(/{sessions}/g, String(rand(1, 4)))
    .replace(/{points}/g, String(rand(1, 3)))
    .replace(/{percent}/g, String(rand(60, 95)))
    .replace(/{students}/g, String(rand(20, 200)))
    .replace(/{levelName}/g, LEVEL_NAMES[level] ?? level)
    .replace(/{topic}/g, topic)
    .replace(/{examName}/g, exam)
    .replace(/{grade}/g, String(gradeMap[level]?.() ?? 10))
    .replace(/{targetScore}/g, String(rand(7, 9)))
    .replace(/{currentScore}/g, String(rand(4, 6)))
    .replace(/{ieltsBand}/g, (rand(70, 90) / 10).toFixed(1))
    .replace(/{speakingBand}/g, (rand(65, 90) / 10).toFixed(1))
    .replace(/{writingBand}/g, (rand(60, 85) / 10).toFixed(1))
    .replace(/{currentBand}/g, (rand(50, 65) / 10).toFixed(1))
    .replace(/{targetBand}/g, (rand(65, 80) / 10).toFixed(1))
    .replace(/{bandDelta}/g, '1.0-1.5')
    .replace(/{focusSkill}/g, pick(['Speaking', 'Writing', 'Reading', 'Listening']))
    .replace(/{toeicScore}/g, String(rand(850, 990)))
    .replace(/{scoreDelta}/g, String(rand(100, 300)))
    .replace(/{lang}/g, pick(['Python', 'JavaScript', 'Java', 'C++', 'Go']))
    .replace(/{role}/g, pick(['Senior Backend', 'Mobile Dev', 'Data Engineer', 'Tech Lead']))
    .replace(/{company}/g, pick(COMPANIES))
    .replace(/{country}/g, pick(COUNTRIES))
    .replace(/{project}/g, pick(['CRUD app', 'REST API', 'data pipeline', 'web scraper']))
    .replace(/{jlptLevel}/g, pick(['N5', 'N4', 'N3', 'N2']))
    .replace(/{age}/g, String(rand(20, 45)))
    .replace(/{district}/g, pick(DISTRICTS))
    .replace(/{score}/g, String(rand(85, 110)));
}

type TutorRow = {
  id: string;
  userId: string;
  email: string;
  name: string;
  avatar: string;
  headline: string;
  bio: string;
  hourlyRateVnd: number;
  modality: 'ONLINE' | 'OFFLINE_HN' | 'OFFLINE_HCM' | 'HYBRID';
  subjects: Array<{ slug: string; level: string }>;
  ratingAvg: string | null;
  ratingCount: number;
  sessionsCompleted: number;
  verificationStatus: 'NONE' | 'KYC_PENDING' | 'KYC_VERIFIED';
  instantBookEnabled: boolean;
  trialSessionEnabled: boolean;
  avgResponseMinutes: number | null;
  responseRatePct: number | null;
};

function weightedPick(subjects: SubjectSpec[]): SubjectSpec {
  const total = subjects.reduce((a, s) => a + s.weight, 0);
  let r = Math.random() * total;
  for (const s of subjects) {
    r -= s.weight;
    if (r <= 0) return s;
  }
  return subjects[0]!;
}

function genTutor(i: number): TutorRow {
  const name = genName();
  const slug = `${slugify(name)}-${i}`;
  const sub = weightedPick(SUBJECTS);
  const primaryLevel = pick(sub.levels);
  const subjects: TutorRow['subjects'] = [{ slug: sub.slug, level: primaryLevel }];
  if (maybe(0.4) && sub.levels.length > 1) {
    const lvl2 = pick(sub.levels.filter((l) => l !== primaryLevel));
    if (lvl2) subjects.push({ slug: sub.slug, level: lvl2 });
  }
  if (maybe(0.25)) {
    const sub2 = weightedPick(SUBJECTS.filter((s) => s.slug !== sub.slug));
    const lvl2 = pick(sub2.levels);
    subjects.push({ slug: sub2.slug, level: lvl2 });
  }

  const modality = (() => {
    const r = Math.random();
    if (r < 0.4) return 'ONLINE';
    if (r < 0.75) return 'HYBRID';
    if (r < 0.87) return 'OFFLINE_HN';
    return 'OFFLINE_HCM';
  })() as TutorRow['modality'];

  const headline = fillTemplate(pick(sub.headlineTemplates), sub, primaryLevel);
  const bio = fillTemplate(pick(sub.bioTemplates), sub, primaryLevel);
  const rate = Math.max(80, Math.min(700, Math.round(normal(220, 90)))) * 1000;

  const hasRating = maybe(0.7);
  const ratingAvg = hasRating ? Math.max(3.5, Math.min(5.0, normal(4.6, 0.3))).toFixed(1) : null;
  const ratingCount = hasRating ? rand(3, 60) : 0;
  const sessionsCompleted = hasRating ? Math.round(Math.exp(normal(3.5, 1.2))) : rand(0, 5);

  return {
    id: '',
    userId: '',
    email: `${slug}${SEED_SUFFIX}`,
    name,
    avatar: `https://api.dicebear.com/9.x/avataaars/svg?seed=${slug}`,
    headline,
    bio,
    hourlyRateVnd: rate,
    modality,
    subjects,
    ratingAvg,
    ratingCount,
    sessionsCompleted,
    verificationStatus: hasRating ? (maybe(0.7) ? 'KYC_VERIFIED' : 'KYC_PENDING') : 'NONE',
    instantBookEnabled: maybe(0.3),
    trialSessionEnabled: maybe(0.6),
    avgResponseMinutes: maybe(0.8) ? rand(5, 180) : null,
    responseRatePct: maybe(0.8) ? rand(70, 100) : null,
  };
}

type RequestRow = {
  id: string;
  studentEmail: string;
  studentName: string;
  title: string;
  description: string;
  subjectSlug: string;
  level: string;
  budgetVnd: number | null;
  modality: 'ONLINE' | 'OFFLINE_HN' | 'OFFLINE_HCM' | 'HYBRID';
  urgency: 'ASAP' | 'THIS_WEEK' | 'THIS_MONTH' | 'FLEXIBLE';
  status: 'OPEN' | 'MATCHED' | 'CLOSED';
};

function genRequest(i: number): RequestRow {
  const sub = weightedPick(SUBJECTS);
  const level = pick(sub.levels);
  const name = genName();
  const slug = `${slugify(name)}-${i}`;
  const title = fillTemplate(pick(sub.requestTitles), sub, level);
  const description = fillTemplate(pick(sub.requestDescTemplates), sub, level);

  const modality = (() => {
    const r = Math.random();
    if (r < 0.5) return 'ONLINE';
    if (r < 0.7) return 'OFFLINE_HN';
    if (r < 0.9) return 'OFFLINE_HCM';
    return 'HYBRID';
  })() as RequestRow['modality'];

  const budget = maybe(0.8)
    ? Math.max(100, Math.min(500, Math.round(normal(220, 80)))) * 1000
    : null;
  const urgency = (() => {
    const r = Math.random();
    if (r < 0.15) return 'ASAP';
    if (r < 0.45) return 'THIS_WEEK';
    if (r < 0.75) return 'THIS_MONTH';
    return 'FLEXIBLE';
  })() as RequestRow['urgency'];
  const status = (() => {
    const r = Math.random();
    if (r < 0.8) return 'OPEN';
    if (r < 0.95) return 'MATCHED';
    return 'CLOSED';
  })() as RequestRow['status'];

  return {
    id: '',
    studentEmail: `${slug}${STUDENT_SUFFIX}`,
    studentName: name,
    title,
    description,
    subjectSlug: sub.slug,
    level,
    budgetVnd: budget,
    modality,
    urgency,
    status,
  };
}

async function resetSeed() {
  console.log('[reset] Tìm users đã seed...');
  const seededUsers = await db
    .select({ id: user.id })
    .from(user)
    .where(like(user.email, `%${SEED_SUFFIX}`));
  const seededStudents = await db
    .select({ id: user.id })
    .from(user)
    .where(like(user.email, `%${STUDENT_SUFFIX}`));
  const allIds = [...seededUsers, ...seededStudents].map((u) => u.id);
  if (allIds.length === 0) {
    console.log('[reset] Không có dữ liệu seed cũ.');
    return;
  }

  const tutors = await db
    .select({ id: tutorProfile.id })
    .from(tutorProfile)
    .where(inArray(tutorProfile.userId, allIds));
  const tutorIds = tutors.map((t) => t.id);

  if (tutorIds.length > 0) {
    await db.delete(tutorReview).where(inArray(tutorReview.tutorId, tutorIds));
    await db.delete(tutoringBooking).where(inArray(tutoringBooking.tutorId, tutorIds));
    await db.delete(tutorAvailability).where(inArray(tutorAvailability.tutorId, tutorIds));
    await db.delete(tutorSubject).where(inArray(tutorSubject.tutorId, tutorIds));
    await db.delete(tutorProfile).where(inArray(tutorProfile.id, tutorIds));
  }
  await db.delete(tutorRequest).where(inArray(tutorRequest.studentId, allIds));
  await db.delete(user).where(inArray(user.id, allIds));
  console.log(`[reset] Đã xoá ${allIds.length} user, ${tutorIds.length} tutor profile.`);
}

async function main() {
  if (RESET) {
    await resetSeed();
    console.log('[done] Reset xong.');
    process.exit(0);
  }

  console.log('[seed] Bắt đầu — sẽ tạo 200 tutor + 300 request + reviews...');

  const tutors: TutorRow[] = Array.from({ length: 200 }, (_, i) => genTutor(i));
  console.log('[seed] Tutor seeds prepared, inserting users...');

  for (const t of tutors) {
    const [u] = await db
      .insert(user)
      .values({
        id: randomUUID(),
        name: t.name,
        email: t.email,
        emailVerified: true,
        image: t.avatar,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning({ id: user.id });
    t.userId = u!.id;
  }
  console.log(`[seed] Created ${tutors.length} tutor users.`);

  console.log('[seed] Embedding tutor bios (sequential, can take 1-2 min)...');
  const tutorEmbeddings = new Map<string, number[] | null>();
  if (!NO_EMBED) {
    for (let i = 0; i < tutors.length; i++) {
      const t = tutors[i]!;
      try {
        const emb = await embedQuery(`${t.headline}\n${t.bio}`.slice(0, 8000));
        tutorEmbeddings.set(t.email, emb);
      } catch (err) {
        console.error(`[embed-fail] ${t.email}`, (err as Error).message);
        tutorEmbeddings.set(t.email, null);
      }
      if ((i + 1) % 20 === 0) console.log(`  embedded ${i + 1}/${tutors.length}`);
    }
  } else {
    console.log('[seed] --no-embed flag detected, skipping embeddings.');
  }

  for (const t of tutors) {
    const emb = tutorEmbeddings.get(t.email) ?? null;
    const [p] = await db
      .insert(tutorProfile)
      .values({
        userId: t.userId,
        headline: t.headline,
        bio: t.bio,
        hourlyRateVnd: t.hourlyRateVnd,
        modality: t.modality,
        avatarUrl: t.avatar,
        status: 'PUBLISHED',
        ratingAvg: t.ratingAvg,
        ratingCount: t.ratingCount,
        sessionsCompleted: t.sessionsCompleted,
        verificationStatus: t.verificationStatus,
        instantBookEnabled: t.instantBookEnabled,
        trialSessionEnabled: t.trialSessionEnabled,
        avgResponseMinutes: t.avgResponseMinutes,
        responseRatePct: t.responseRatePct,
        ...(emb ? { bioEmbedding: emb, bioEmbeddingUpdatedAt: new Date() } : {}),
      })
      .returning({ id: tutorProfile.id });
    t.id = p!.id;

    await db.insert(tutorSubject).values(
      t.subjects.map((s) => ({
        tutorId: t.id,
        subjectSlug: s.slug,
        level: s.level,
      })),
    );

    const slotCount = rand(3, 6);
    const days = pickN([0, 1, 2, 3, 4, 5, 6], slotCount);
    await db.insert(tutorAvailability).values(
      days.map((day) => {
        const startHour = rand(8, 19);
        const endHour = Math.min(22, startHour + rand(2, 4));
        return {
          tutorId: t.id,
          dayOfWeek: day,
          startTime: `${String(startHour).padStart(2, '0')}:00`,
          endTime: `${String(endHour).padStart(2, '0')}:00`,
          timezone: 'Asia/Ho_Chi_Minh',
        };
      }),
    );
  }
  console.log(`[seed] Inserted ${tutors.length} tutor_profile + subjects + availability.`);

  const requests: RequestRow[] = Array.from({ length: 300 }, (_, i) => genRequest(i));
  const studentIdByEmail = new Map<string, string>();

  for (const r of requests) {
    if (studentIdByEmail.has(r.studentEmail)) continue;
    const [u] = await db
      .insert(user)
      .values({
        id: randomUUID(),
        name: r.studentName,
        email: r.studentEmail,
        emailVerified: true,
        image: `https://api.dicebear.com/9.x/avataaars/svg?seed=${r.studentEmail}`,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning({ id: user.id });
    studentIdByEmail.set(r.studentEmail, u!.id);
  }
  console.log(`[seed] Created ${studentIdByEmail.size} student users.`);

  console.log('[seed] Embedding request descriptions...');
  const reqEmbeddings = new Map<number, number[] | null>();
  if (!NO_EMBED) {
    for (let i = 0; i < requests.length; i++) {
      const r = requests[i]!;
      try {
        const emb = await embedQuery(`${r.title}\n${r.description}`.slice(0, 8000));
        reqEmbeddings.set(i, emb);
      } catch (err) {
        console.error(`[embed-fail-req] ${i}`, (err as Error).message);
        reqEmbeddings.set(i, null);
      }
      if ((i + 1) % 30 === 0) console.log(`  embedded ${i + 1}/${requests.length}`);
    }
  }

  for (let i = 0; i < requests.length; i++) {
    const r = requests[i]!;
    const emb = reqEmbeddings.get(i) ?? null;
    const sid = studentIdByEmail.get(r.studentEmail)!;
    await db.insert(tutorRequest).values({
      studentId: sid,
      title: r.title,
      description: r.description,
      subjectSlug: r.subjectSlug,
      level: r.level,
      budgetVnd: r.budgetVnd,
      modality: r.modality,
      urgency: r.urgency,
      status: r.status,
      ...(emb ? { embedding: emb, embeddingUpdatedAt: new Date() } : {}),
    });
  }
  console.log(`[seed] Inserted ${requests.length} tutor_request.`);

  console.log('[seed] Generating bookings + reviews...');
  let reviewsCreated = 0;
  let bookingsCreated = 0;
  const studentUserIds = Array.from(studentIdByEmail.values());

  for (const t of tutors) {
    if (t.ratingCount === 0) continue;
    for (let i = 0; i < t.ratingCount; i++) {
      const reviewerId = pick(studentUserIds);
      const pastDate = new Date(Date.now() - rand(7, 180) * 24 * 60 * 60 * 1000);
      const endDate = new Date(pastDate.getTime() + 60 * 60 * 1000);
      const [booking] = await db
        .insert(tutoringBooking)
        .values({
          tutorId: t.id,
          studentId: reviewerId,
          subjectSlug: t.subjects[0]!.slug,
          level: t.subjects[0]!.level,
          startAt: pastDate,
          endAt: endDate,
          rateVnd: t.hourlyRateVnd,
          status: 'COMPLETED',
        })
        .returning({ id: tutoringBooking.id });
      bookingsCreated++;
      const rating = Number(t.ratingAvg) >= 4.5 ? (maybe(0.8) ? 5 : 4) : maybe(0.5) ? 4 : 3;
      await db.insert(tutorReview).values({
        bookingId: booking!.id,
        reviewerId,
        tutorId: t.id,
        rating,
        comment: pick([
          'Cô dạy rất nhiệt tình, dễ hiểu. Con tiến bộ rõ rệt sau vài buổi.',
          'Thầy có phương pháp tốt, bài giảng rõ ràng. Sẽ tiếp tục học.',
          'Rất hài lòng. Học được nhiều mẹo làm bài trắc nghiệm nhanh.',
          'Giảng viên kiên nhẫn, biết cách giải thích cho người mất gốc.',
          'Phong cách dạy thoải mái, không áp lực. Recommend!',
          'Cô chấm essay rất kỹ, feedback hữu ích. 5 sao.',
        ]),
        tags: pickN(
          ['nhiệt tình', 'dễ hiểu', 'chuyên môn cao', 'kiên nhẫn', 'đúng giờ'],
          rand(1, 3),
        ),
        helpfulCount: rand(0, 8),
      });
      reviewsCreated++;
    }
  }
  console.log(`[seed] Generated ${bookingsCreated} bookings + ${reviewsCreated} reviews.`);

  console.log('\n[done] Seed V5 complete!');
  console.log(`  Tutors: ${tutors.length}`);
  console.log(`  Requests: ${requests.length}`);
  console.log(`  Bookings: ${bookingsCreated}`);
  console.log(`  Reviews: ${reviewsCreated}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('[seed-fatal]', err);
  process.exit(1);
});
