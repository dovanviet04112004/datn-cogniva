/**
 * Seed Tutoring Marketplace demo data — DEV ONLY.
 *
 * Tạo 5 tutor PUBLISHED + 3 student request OPEN với data đa dạng để test
 * browse / filter / apply UI. Idempotent — chạy nhiều lần không gây trùng
 * (sử dụng email "*@seed.cogniva.local" để identify + upsert).
 *
 * Usage:
 *   cd apps/web
 *   pnpm exec tsx --env-file=.env.local scripts/seed-tutoring.ts
 *
 * Reset (xoá hết seed data):
 *   pnpm exec tsx --env-file=.env.local scripts/seed-tutoring.ts --reset
 */
import { randomUUID } from 'node:crypto';
import { eq, inArray, like } from 'drizzle-orm';
import {
  db,
  tutorApplication,
  tutorAvailability,
  tutorProfile,
  tutorRequest,
  tutorSubject,
  user,
} from '@cogniva/db';

const SEED_EMAIL_SUFFIX = '@seed.cogniva.local';

type TutorSeed = {
  email: string;
  name: string;
  image: string | null;
  headline: string;
  bio: string;
  hourlyRateK: number;
  modality: 'ONLINE' | 'OFFLINE_HN' | 'OFFLINE_HCM' | 'HYBRID';
  subjects: Array<{ slug: string; level: string; verified?: boolean }>;
  availability: Array<{ day: number; start: string; end: string }>;
  ratingAvg: string | null;
  ratingCount: number;
  sessionsCompleted: number;
  verificationStatus: 'NONE' | 'KYC_PENDING' | 'KYC_VERIFIED';
};

const TUTORS: TutorSeed[] = [
  {
    email: `mai-anh${SEED_EMAIL_SUFFIX}`,
    name: 'Nguyễn Mai Anh',
    image: 'https://api.dicebear.com/9.x/avataaars/svg?seed=mai-anh',
    headline: 'Gia sư Toán THPT 8 năm kinh nghiệm — luyện thi đại học khối A/A1',
    bio: 'Tốt nghiệp ĐH Sư phạm Hà Nội chuyên ngành Toán, 8 năm dạy 1-1 + nhóm nhỏ. Học sinh đậu Bách Khoa, Ngoại Thương, Y Hà Nội mỗi năm. Phương pháp: chia nhỏ chương trình theo dạng bài, luyện đề có tính toán điểm tự động sau mỗi buổi. Cam kết nâng 1-2 điểm sau 6 tuần với học sinh chăm chỉ.',
    hourlyRateK: 250,
    modality: 'HYBRID',
    subjects: [
      { slug: 'math', level: 'HIGH_SCHOOL', verified: true },
      { slug: 'math', level: 'UNIVERSITY' },
    ],
    availability: [
      { day: 1, start: '19:00', end: '21:00' },
      { day: 3, start: '19:00', end: '21:00' },
      { day: 5, start: '19:00', end: '21:00' },
      { day: 6, start: '08:00', end: '11:00' },
      { day: 0, start: '14:00', end: '17:00' },
    ],
    ratingAvg: '4.9',
    ratingCount: 38,
    sessionsCompleted: 412,
    verificationStatus: 'KYC_VERIFIED',
  },
  {
    email: `david-le${SEED_EMAIL_SUFFIX}`,
    name: 'Lê Hoàng David',
    image: 'https://api.dicebear.com/9.x/avataaars/svg?seed=david-le',
    headline: 'IELTS 8.0 — chuyên luyện band 6.5+ cho người đi làm bận rộn',
    bio: 'Cựu sinh viên RMIT, IELTS overall 8.0 (Speaking 8.5, Writing 7.5). 5 năm dạy IELTS cho ~120 học viên, average tăng từ 5.5 → 7.0 trong 3 tháng. Format dạy: 70% practice + correction cá nhân hoá, 30% strategy. Hỗ trợ chấm essay không giới hạn ngoài giờ học qua Notion.',
    hourlyRateK: 400,
    modality: 'ONLINE',
    subjects: [
      { slug: 'english-ielts', level: 'ADULT', verified: true },
      { slug: 'english', level: 'UNIVERSITY' },
      { slug: 'english-toeic', level: 'ADULT' },
    ],
    availability: [
      { day: 2, start: '20:00', end: '22:00' },
      { day: 4, start: '20:00', end: '22:00' },
      { day: 6, start: '09:00', end: '12:00' },
      { day: 6, start: '14:00', end: '17:00' },
      { day: 0, start: '09:00', end: '12:00' },
    ],
    ratingAvg: '4.8',
    ratingCount: 51,
    sessionsCompleted: 287,
    verificationStatus: 'KYC_VERIFIED',
  },
  {
    email: `tran-quoc${SEED_EMAIL_SUFFIX}`,
    name: 'Trần Quốc Khánh',
    image: 'https://api.dicebear.com/9.x/avataaars/svg?seed=quoc-khanh',
    headline: 'Lập trình Python + giải thuật — gia sư cho học sinh chuyên Tin và sinh viên CNTT',
    bio: 'ICPC Asia regional 3 năm, full-stack engineer tại 1 fintech VN. Dạy Python từ cơ bản đến advanced + cấu trúc dữ liệu / giải thuật cho học sinh trường chuyên Tin (HSGS, Lê Hồng Phong) và sinh viên BK / FPT chuẩn bị phỏng vấn. Practice trên LeetCode/Codeforces, review code chi tiết sau mỗi bài tập.',
    hourlyRateK: 350,
    modality: 'ONLINE',
    subjects: [
      { slug: 'cs-programming', level: 'HIGH_SCHOOL' },
      { slug: 'cs-programming', level: 'UNIVERSITY' },
      { slug: 'cs-algorithms', level: 'UNIVERSITY' },
    ],
    availability: [
      { day: 1, start: '20:00', end: '22:00' },
      { day: 3, start: '20:00', end: '22:00' },
      { day: 5, start: '20:00', end: '22:00' },
      { day: 6, start: '15:00', end: '18:00' },
    ],
    ratingAvg: '4.7',
    ratingCount: 22,
    sessionsCompleted: 156,
    verificationStatus: 'KYC_VERIFIED',
  },
  {
    email: `pham-thuy${SEED_EMAIL_SUFFIX}`,
    name: 'Phạm Thu Thuỷ',
    image: 'https://api.dicebear.com/9.x/avataaars/svg?seed=thu-thuy',
    headline: 'Hoá học THCS + THPT — phương pháp giải bài tập nhanh, dễ nhớ',
    bio: 'Cử nhân Hoá ĐH Khoa học Tự nhiên, 4 năm dạy gia sư bán thời gian. Học sinh thường yếu phần phương trình + mol → tôi xây dựng hệ thống công thức tóm tắt + bài tập leo thang. Buổi đầu free 30 phút để đánh giá năng lực.',
    hourlyRateK: 180,
    modality: 'OFFLINE_HN',
    subjects: [
      { slug: 'chemistry', level: 'SECONDARY' },
      { slug: 'chemistry', level: 'HIGH_SCHOOL' },
    ],
    availability: [
      { day: 2, start: '18:00', end: '20:00' },
      { day: 4, start: '18:00', end: '20:00' },
      { day: 6, start: '10:00', end: '12:00' },
      { day: 0, start: '15:00', end: '18:00' },
    ],
    ratingAvg: '4.6',
    ratingCount: 14,
    sessionsCompleted: 89,
    verificationStatus: 'KYC_PENDING',
  },
  {
    email: `vu-minh${SEED_EMAIL_SUFFIX}`,
    name: 'Vũ Minh Quang',
    image: 'https://api.dicebear.com/9.x/avataaars/svg?seed=minh-quang',
    headline: 'Tiếng Nhật N3-N1 — du học sinh Tokyo, dạy giao tiếp + JLPT',
    bio: 'Du học sinh đại học Waseda (Tokyo) năm 3, JLPT N1 (160/180). Dạy tiếng Nhật cho người mới bắt đầu đến luyện N3-N2-N1. Sách chính: Minna no Nihongo + Try N-series. Luyện nghe qua anime + drama có script. Hỗ trợ tư vấn du học Nhật.',
    hourlyRateK: 220,
    modality: 'ONLINE',
    subjects: [
      { slug: 'japanese', level: 'HIGH_SCHOOL' },
      { slug: 'japanese', level: 'UNIVERSITY' },
      { slug: 'japanese', level: 'ADULT' },
    ],
    availability: [
      { day: 1, start: '21:00', end: '23:00' },
      { day: 3, start: '21:00', end: '23:00' },
      { day: 6, start: '08:00', end: '11:00' },
      { day: 0, start: '20:00', end: '22:00' },
    ],
    ratingAvg: null,
    ratingCount: 0,
    sessionsCompleted: 12,
    verificationStatus: 'NONE',
  },
];

type RequestSeed = {
  email: string;
  name: string;
  image: string | null;
  title: string;
  description: string;
  subjectSlug: string;
  level: string;
  budgetK: number | null;
  modality: 'ONLINE' | 'OFFLINE_HN' | 'OFFLINE_HCM' | 'HYBRID';
  urgency: 'ASAP' | 'THIS_WEEK' | 'THIS_MONTH' | 'FLEXIBLE';
};

const REQUESTS: RequestSeed[] = [
  {
    email: `hsinh-12a${SEED_EMAIL_SUFFIX}`,
    name: 'Hoàng Văn Bách',
    image: 'https://api.dicebear.com/9.x/avataaars/svg?seed=hoang-bach',
    title: 'Cần gia sư Toán 12 luyện thi đại học khối A — đang yếu Tích phân + Hình OXYZ',
    description: 'Em đang học lớp 12 trường công ở Hà Nội, mục tiêu đậu Bách Khoa khoa Kỹ thuật ô tô. Toán hiện tại được khoảng 6.5-7 trong các bài kiểm tra. Đặc biệt yếu phần Tích phân ứng dụng và Hình giải tích OXYZ — làm bài rất chậm và hay sai dấu. Mong gia sư có kinh nghiệm luyện đề THPT, dạy mẹo nhanh cho trắc nghiệm. Thời gian rảnh tối thứ 3, 5, 7. Học online được.',
    subjectSlug: 'math',
    level: 'HIGH_SCHOOL',
    budgetK: 300,
    modality: 'ONLINE',
    urgency: 'ASAP',
  },
  {
    email: `congty-marketing${SEED_EMAIL_SUFFIX}`,
    name: 'Trịnh Linh Đan',
    image: 'https://api.dicebear.com/9.x/avataaars/svg?seed=linh-dan',
    title: 'Tìm gia sư IELTS 1-1, target 7.0 trong 4 tháng — đang ở band 5.5',
    description: 'Mình đi làm marketing 3 năm, IELTS hiện tại 5.5 (Reading 6, Listening 6, Writing 5, Speaking 5). Cần đẩy lên 7.0 cho hồ sơ du học Úc 9/2026. Khó khăn lớn nhất ở Writing task 2 (toàn 5.5) và Speaking part 2-3 (hay bị ấp úng). Mong gia sư có band 8.0+, có thể chấm essay chi tiết và mock speaking interview ít nhất 1 lần/tuần. Có thể đầu tư 6-8 triệu/tháng.',
    subjectSlug: 'english-ielts',
    level: 'ADULT',
    budgetK: 500,
    modality: 'ONLINE',
    urgency: 'THIS_WEEK',
  },
  {
    email: `sv-bk${SEED_EMAIL_SUFFIX}`,
    name: 'Đỗ Quang Huy',
    image: 'https://api.dicebear.com/9.x/avataaars/svg?seed=quang-huy',
    title: 'Sinh viên năm 2 BK cần gia sư Cấu trúc dữ liệu — chuẩn bị thi cuối kỳ',
    description: 'Em đang học DSA tại BK, cuối kỳ còn 6 tuần. Đã hiểu cơ bản (stack, queue, linked list, tree) nhưng đến phần Graph, Dynamic Programming là không làm được. Muốn tìm anh chị có kinh nghiệm ACM/ICPC hoặc đã đi làm CNTT để dạy cách tư duy + làm bài tập trên HackerRank. Học online OK, có thể buổi 1.5-2h, 2 buổi/tuần.',
    subjectSlug: 'cs-algorithms',
    level: 'UNIVERSITY',
    budgetK: 400,
    modality: 'ONLINE',
    urgency: 'THIS_MONTH',
  },
  {
    email: `me-cua-be${SEED_EMAIL_SUFFIX}`,
    name: 'Nguyễn Hồng Hạnh',
    image: 'https://api.dicebear.com/9.x/avataaars/svg?seed=hong-hanh',
    title: 'Gia sư Hoá lớp 9 cho con — chuẩn bị thi vào lớp 10 chuyên',
    description: 'Con mình đang học lớp 9, có nguyện vọng thi vào chuyên Hoá KHTN. Hiện tại điểm Hoá trên lớp tầm 8.5-9 nhưng đề thi chuyên đòi hỏi tư duy cao hơn nhiều. Muốn tìm gia sư có kinh nghiệm luyện đội tuyển hoặc thi chuyên, dạy nâng cao tại nhà ở khu vực Cầu Giấy. Lịch học: 2 buổi tối/tuần, 2h/buổi.',
    subjectSlug: 'chemistry',
    level: 'SECONDARY',
    budgetK: 250,
    modality: 'OFFLINE_HN',
    urgency: 'FLEXIBLE',
  },
];

async function reset() {
  console.log('🧹 Xoá seed data cũ...');
  const seedUsers = await db
    .select({ id: user.id })
    .from(user)
    .where(like(user.email, `%${SEED_EMAIL_SUFFIX}`));
  if (seedUsers.length === 0) {
    console.log('  (không có seed user nào)');
    return;
  }
  const ids = seedUsers.map((u) => u.id);

  // tutor_application FK → tutor_profile + tutor_request → cascade xoá khi
  // xoá profile/request, nhưng để chắc chắn ta clear theo tutor profile ids
  const seedProfiles = await db
    .select({ id: tutorProfile.id })
    .from(tutorProfile)
    .where(inArray(tutorProfile.userId, ids));
  if (seedProfiles.length > 0) {
    const pIds = seedProfiles.map((p) => p.id);
    await db.delete(tutorApplication).where(inArray(tutorApplication.tutorId, pIds));
    await db.delete(tutorAvailability).where(inArray(tutorAvailability.tutorId, pIds));
    await db.delete(tutorSubject).where(inArray(tutorSubject.tutorId, pIds));
    await db.delete(tutorProfile).where(inArray(tutorProfile.id, pIds));
  }
  await db.delete(tutorRequest).where(inArray(tutorRequest.studentId, ids));
  // Xoá user cuối (FK constraint cascade sẽ clear session/account)
  await db.delete(user).where(inArray(user.id, ids));
  console.log(`  ✓ Xoá ${seedUsers.length} user + dữ liệu liên quan`);
}

async function ensureUser(email: string, name: string, image: string | null): Promise<string> {
  // Upsert user theo email
  const [existing] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email))
    .limit(1);
  if (existing) return existing.id;
  const id = randomUUID();
  await db.insert(user).values({
    id,
    email,
    name,
    image,
    emailVerified: true,
    plan: 'FREE',
    isPublic: true,
    preferences: {},
  });
  return id;
}

async function seedTutors() {
  console.log(`\n👩‍🏫 Seed ${TUTORS.length} tutor profile...`);
  for (const t of TUTORS) {
    const userId = await ensureUser(t.email, t.name, t.image);

    // Upsert tutor_profile theo userId (unique)
    const [existing] = await db
      .select({ id: tutorProfile.id })
      .from(tutorProfile)
      .where(eq(tutorProfile.userId, userId))
      .limit(1);

    let profileId: string;
    if (existing) {
      profileId = existing.id;
      await db
        .update(tutorProfile)
        .set({
          headline: t.headline,
          bio: t.bio,
          hourlyRateVnd: t.hourlyRateK * 1000,
          modality: t.modality,
          status: 'PUBLISHED',
          avatarUrl: t.image,
          sessionsCompleted: t.sessionsCompleted,
          ratingAvg: t.ratingAvg,
          ratingCount: t.ratingCount,
          verificationStatus: t.verificationStatus,
          updatedAt: new Date(),
        })
        .where(eq(tutorProfile.id, profileId));
      // Wipe existing subjects + availability để insert lại
      await db.delete(tutorSubject).where(eq(tutorSubject.tutorId, profileId));
      await db.delete(tutorAvailability).where(eq(tutorAvailability.tutorId, profileId));
    } else {
      const inserted = await db
        .insert(tutorProfile)
        .values({
          userId,
          headline: t.headline,
          bio: t.bio,
          hourlyRateVnd: t.hourlyRateK * 1000,
          modality: t.modality,
          status: 'PUBLISHED',
          avatarUrl: t.image,
          sessionsCompleted: t.sessionsCompleted,
          ratingAvg: t.ratingAvg,
          ratingCount: t.ratingCount,
          verificationStatus: t.verificationStatus,
        })
        .returning({ id: tutorProfile.id });
      if (!inserted[0]) throw new Error('insert tutor_profile failed');
      profileId = inserted[0].id;
    }

    // Subjects
    await db.insert(tutorSubject).values(
      t.subjects.map((s) => ({
        tutorId: profileId,
        subjectSlug: s.slug,
        level: s.level,
        verifiedAt: s.verified ? new Date() : null,
        verifyScore: s.verified ? 85 : null,
      })),
    );

    // Availability
    await db.insert(tutorAvailability).values(
      t.availability.map((a) => ({
        tutorId: profileId,
        dayOfWeek: a.day,
        startTime: a.start,
        endTime: a.end,
        timezone: 'Asia/Ho_Chi_Minh',
      })),
    );

    console.log(`  ✓ ${t.name} (${t.subjects.length} môn, ${t.availability.length} slot)`);
  }
}

async function seedRequests() {
  console.log(`\n📋 Seed ${REQUESTS.length} student request...`);
  for (const r of REQUESTS) {
    const userId = await ensureUser(r.email, r.name, r.image);

    // Idempotent: mỗi seed user chỉ post 1 request → xoá toàn bộ request
    // cũ của user này (cascade xoá luôn applications) rồi insert mới.
    // Đơn giản + đảm bảo data luôn fresh.
    await db.delete(tutorRequest).where(eq(tutorRequest.studentId, userId));

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);
    await db.insert(tutorRequest).values({
      studentId: userId,
      title: r.title,
      description: r.description,
      subjectSlug: r.subjectSlug,
      level: r.level,
      budgetVnd: r.budgetK ? r.budgetK * 1000 : null,
      modality: r.modality,
      urgency: r.urgency,
      status: 'OPEN',
      expiresAt,
    });

    console.log(`  ✓ ${r.name}: ${r.title.slice(0, 60)}...`);
  }
}

async function main() {
  const shouldReset = process.argv.includes('--reset');
  if (shouldReset) {
    await reset();
    console.log('\n✅ Reset xong.');
    process.exit(0);
  }

  console.log('🌱 Seed Tutoring Marketplace demo data');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  await seedTutors();
  await seedRequests();

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✅ Seed xong. Truy cập:');
  console.log('   • /tutoring             — browse gia sư');
  console.log('   • /tutoring?tab=requests — browse yêu cầu');
  console.log('\nReset: tsx scripts/seed-tutoring.ts --reset');
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Seed thất bại:', err);
  process.exit(1);
});
