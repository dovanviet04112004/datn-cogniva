import { randomUUID } from 'node:crypto';
import { eq, inArray, like } from 'drizzle-orm';

import { db, libraryDoc, libraryDocChunk, user } from '@cogniva/db';

import { embedBatch } from '../src/lib/ingest/embed';
import { embedQuery } from '../src/lib/ingest/embed-query';

const SEED_PREFIX = 'seed-v1://';
const RESET = process.argv.includes('--reset');
const NO_EMBED = process.argv.includes('--no-embed');

const VN_NAMES = [
  'Nguyễn Mai Anh',
  'Trần Hùng Dũng',
  'Lê Thuỳ Linh',
  'Phạm Đức Hiếu',
  'Hoàng Khánh Vy',
  'Vũ Minh Quân',
  'Đỗ Bảo Châu',
  'Bùi Hà My',
  'Lương Tuấn Khoa',
  'Phan Diệu Hương',
  'Trịnh Hải Sơn',
  'Đoàn Mỹ Linh',
  'Cao Thành Nam',
  'Đặng Yến Nhi',
  'Lý Quốc Việt',
];

type DocSeed = {
  title: string;
  description: string;
  subjectSlug: string;
  level: string;
  grade?: number;
  docType: string;
  examType?: string;
  schoolYear?: string;
  tags: string[];
  fileFormat: 'pdf' | 'docx' | 'image';
  pageCount: number;
  badges: string[];
  chunks: string[];
};

const DOCS: DocSeed[] = [
  {
    title: 'Đề cương Toán 12 — Đạo hàm + ứng dụng',
    description:
      'Tóm tắt 30 trang đầy đủ lý thuyết đạo hàm, ứng dụng tìm cực trị, tiệm cận và bài toán liên quan. Bao gồm 50 bài tập trắc nghiệm có đáp án.',
    subjectSlug: 'math',
    level: 'HIGH_SCHOOL',
    grade: 12,
    docType: 'summary',
    tags: ['đạo hàm', 'cực trị', 'tiệm cận'],
    fileFormat: 'pdf',
    pageCount: 30,
    badges: ['outcome_verified', 'syllabus_complete'],
    chunks: [
      "Định nghĩa đạo hàm: f'(x) = lim(h→0) [f(x+h) - f(x)] / h. Đạo hàm tại điểm x₀ thể hiện tốc độ thay đổi tức thời.",
      "Quy tắc đạo hàm cơ bản: (u+v)' = u' + v', (u·v)' = u'v + uv', (u/v)' = (u'v - uv')/v².",
      'Ứng dụng đạo hàm: xét tính đơn điệu, tìm cực trị, tìm tiệm cận của đồ thị hàm số.',
      "Đạo hàm hàm hợp: nếu y = f(g(x)) thì y' = f'(g(x)) · g'(x). Đây là dạng quan trọng nhất.",
      "Bài toán cực trị: hàm số đạt cực đại tại x₀ khi f'(x₀) = 0 và f''(x₀) < 0.",
    ],
  },
  {
    title: 'Đề thi tốt nghiệp THPT Toán 2024 (có lời giải)',
    description:
      'Đề thi chính thức kèm lời giải chi tiết 50 câu trắc nghiệm. Đáp án A/B/C/D rõ ràng, có chú giải phương pháp ngắn cho từng câu.',
    subjectSlug: 'math',
    level: 'HIGH_SCHOOL',
    grade: 12,
    docType: 'exam',
    examType: 'graduation',
    schoolYear: '2023-2024',
    tags: ['đề thi', 'tốt nghiệp', 'lời giải'],
    fileFormat: 'pdf',
    pageCount: 20,
    badges: ['outcome_verified'],
    chunks: [
      'Câu 1: Tìm tập xác định của hàm số y = log(x² - 4). Đáp án: (-∞, -2) ∪ (2, +∞).',
      'Câu 5: Cho hình chóp đều S.ABCD có cạnh đáy a và cạnh bên 2a. Tính thể tích.',
      'Câu 12: Phương trình 2^x + 3^x = 5 có bao nhiêu nghiệm thực? Áp dụng định lý giá trị trung gian.',
      'Định lý Vi-et cho phương trình bậc 2: x₁ + x₂ = -b/a, x₁·x₂ = c/a.',
    ],
  },
  {
    title: 'Tích phân lớp 12 — phương pháp tính nhanh',
    description:
      'Tổng hợp 8 phương pháp tính tích phân thường gặp: từng phần, đổi biến, lượng giác, hữu tỉ. Mỗi phương pháp kèm 5 ví dụ.',
    subjectSlug: 'math',
    level: 'HIGH_SCHOOL',
    grade: 12,
    docType: 'lecture_notes',
    tags: ['tích phân', 'tích phân từng phần', 'đổi biến'],
    fileFormat: 'pdf',
    pageCount: 25,
    badges: ['power_resource'],
    chunks: [
      'Tích phân từng phần: ∫u·dv = uv - ∫v·du. Mẹo chọn u theo LIATE: Log, Inverse, Algebraic, Trig, Exp.',
      "Tích phân đổi biến: nếu I = ∫f(u(x))·u'(x)dx, đặt t = u(x) → dt = u'(x)dx.",
      'Tích phân hàm lượng giác: ∫sin²x dx = (x - sinx·cosx)/2. Dùng công thức hạ bậc.',
      'Tích phân hàm hữu tỉ: phân tích thành tổng các phân thức cơ bản.',
    ],
  },
  {
    title: 'Bài tập Hình học không gian Oxyz có lời giải',
    description:
      '60 bài tập trắc nghiệm về tọa độ điểm, vector, đường thẳng, mặt phẳng, mặt cầu trong không gian Oxyz. Lời giải chi tiết từng bước.',
    subjectSlug: 'math',
    level: 'HIGH_SCHOOL',
    grade: 12,
    docType: 'exercise',
    tags: ['oxyz', 'đường thẳng', 'mặt phẳng', 'mặt cầu'],
    fileFormat: 'docx',
    pageCount: 35,
    badges: [],
    chunks: [
      'Phương trình mặt cầu (S): (x-a)² + (y-b)² + (z-c)² = R² với tâm I(a,b,c) và bán kính R.',
      'Khoảng cách từ điểm M(x₀,y₀,z₀) đến mặt phẳng (P): Ax + By + Cz + D = 0 là |Ax₀ + By₀ + Cz₀ + D| / √(A² + B² + C²).',
      'Vector pháp tuyến của mặt phẳng qua 3 điểm A, B, C: n = [AB, AC] (tích có hướng).',
    ],
  },
  {
    title: 'Toán lớp 11 — Lượng giác đầy đủ',
    description:
      'Lý thuyết + bài tập lượng giác lớp 11. Bao gồm phương trình lượng giác cơ bản, bậc 2, đẳng cấp, đối xứng.',
    subjectSlug: 'math',
    level: 'HIGH_SCHOOL',
    grade: 11,
    docType: 'lecture_notes',
    tags: ['lượng giác', 'phương trình lượng giác'],
    fileFormat: 'pdf',
    pageCount: 28,
    badges: ['educator_approved'],
    chunks: [
      'Công thức cộng: sin(a+b) = sin·a·cos·b + cos·a·sin·b. cos(a+b) = cos·a·cos·b - sin·a·sin·b.',
      'Phương trình lượng giác cơ bản: sin(x) = m → x = arcsin(m) + k·2π hoặc x = π - arcsin(m) + k·2π.',
      'Phương trình bậc 2 theo sin/cos: đặt t = sinx hoặc cosx (|t| ≤ 1).',
    ],
  },
  {
    title: 'Vật lý 12 — Dao động cơ học',
    description:
      'Bài giảng chi tiết về dao động điều hoà, con lắc lò xo, con lắc đơn. Bao gồm 40 bài tập có lời giải.',
    subjectSlug: 'physics',
    level: 'HIGH_SCHOOL',
    grade: 12,
    docType: 'lecture_notes',
    tags: ['dao động', 'con lắc lò xo', 'con lắc đơn'],
    fileFormat: 'pdf',
    pageCount: 32,
    badges: ['outcome_verified'],
    chunks: [
      'Dao động điều hoà: x = A·cos(ωt + φ). A là biên độ, ω là tần số góc, φ là pha ban đầu.',
      'Chu kì con lắc lò xo: T = 2π√(m/k). Chu kì con lắc đơn: T = 2π√(L/g).',
      'Năng lượng dao động điều hoà: W = (1/2)mω²A² = const. Cơ năng bảo toàn.',
    ],
  },
  {
    title: 'Đề thi thử Vật lý THPT 2024 — 5 đề',
    description: '5 đề thi mẫu của các trường chuyên Bắc Trung Nam. Có đáp án + chấm thử.',
    subjectSlug: 'physics',
    level: 'HIGH_SCHOOL',
    grade: 12,
    docType: 'exam',
    examType: 'graduation',
    schoolYear: '2023-2024',
    tags: ['đề thi thử', 'tốt nghiệp', 'vật lý'],
    fileFormat: 'pdf',
    pageCount: 50,
    badges: ['power_resource'],
    chunks: [
      'Đề 1 câu 5: Một con lắc lò xo dao động với chu kì T = 0.5s. Tính tần số dao động.',
      'Đề 2 câu 10: Sóng cơ học truyền trên dây với vận tốc 20 m/s. Tần số 50 Hz. Tính bước sóng.',
    ],
  },
  {
    title: 'Hoá học 12 — Este và Lipit',
    description:
      'Lý thuyết + bài tập về este và lipit. Phân tích phản ứng thuỷ phân, este hoá. 50 câu trắc nghiệm.',
    subjectSlug: 'chemistry',
    level: 'HIGH_SCHOOL',
    grade: 12,
    docType: 'summary',
    tags: ['este', 'lipit', 'thuỷ phân'],
    fileFormat: 'pdf',
    pageCount: 22,
    badges: ['educator_approved'],
    chunks: [
      "Este có công thức tổng quát R-COO-R'. Phản ứng este hoá: R-COOH + R'-OH ⇌ R-COO-R' + H₂O.",
      'Phản ứng thuỷ phân este trong môi trường kiềm tạo muối và rượu — phản ứng xà phòng hoá.',
    ],
  },
  {
    title: 'IELTS Speaking Part 2 — 60 topic mẫu có sample band 8',
    description:
      'Bộ topic IELTS Speaking Part 2 phổ biến nhất 2024-2025. Mỗi topic có 1 sample band 8 + vocabulary + structure breakdown.',
    subjectSlug: 'english-ielts',
    level: 'ADULT',
    docType: 'reference_book',
    tags: ['speaking', 'part 2', 'band 8', 'sample'],
    fileFormat: 'pdf',
    pageCount: 80,
    badges: ['outcome_verified', 'power_resource'],
    chunks: [
      'Topic: Describe a book you recently read. Use past tense + adjectives like compelling, thought-provoking, eye-opening.',
      'Structure 2-minute talk: Introduction (10s) + Description (60s) + Personal feeling (40s) + Conclusion (10s).',
      'Vocabulary band 8: cherish memories, evoke emotions, resonate with me deeply, leave a lasting impression.',
    ],
  },
  {
    title: 'IELTS Writing Task 2 — 30 essay mẫu band 7.0+',
    description:
      '30 essay đầy đủ cho 8 chủ đề chính: education, environment, technology, society, ... Phân tích structure + lexical resources.',
    subjectSlug: 'english-ielts',
    level: 'ADULT',
    docType: 'reference_book',
    tags: ['writing task 2', 'essay', 'band 7'],
    fileFormat: 'pdf',
    pageCount: 60,
    badges: ['outcome_verified'],
    chunks: [
      'Discussion essay structure: Intro paraphrase + state both sides → BP1 view 1 + example → BP2 view 2 + example → Conclusion personal opinion.',
      'Linking devices band 7: furthermore, nevertheless, despite this, in contrast, by the same token.',
    ],
  },
  {
    title: 'TOEIC Reading — 1000 câu Part 5 có giải',
    description:
      'Tổng hợp 1000 câu Part 5 (Incomplete sentences) đầy đủ explanation từ ETS. Phân loại theo grammar topic.',
    subjectSlug: 'english-toeic',
    level: 'ADULT',
    docType: 'exercise',
    tags: ['toeic', 'part 5', 'grammar'],
    fileFormat: 'pdf',
    pageCount: 120,
    badges: [],
    chunks: [
      'Verb tense agreement: subject + verb must agree in number. "The team is winning" (collective noun = singular).',
      'Modifier placement: dangling modifiers — luôn modifier đứng cạnh từ nó modify.',
    ],
  },
  {
    title: 'Python cho người mới bắt đầu — 50 bài thực hành',
    description:
      '50 bài tập Python progressive từ Hello World đến web scraping. Mỗi bài có solution + giải thích.',
    subjectSlug: 'cs-programming',
    level: 'UNIVERSITY',
    docType: 'exercise',
    tags: ['python', 'beginner', 'programming'],
    fileFormat: 'pdf',
    pageCount: 90,
    badges: ['power_resource'],
    chunks: [
      'List comprehension: [x*2 for x in range(10) if x%2 == 0] — readable hơn for loop truyền thống.',
      'Dictionary comprehension: {k: v for k, v in items.items() if v > 0}.',
      'Async/await: dùng cho IO-bound (network, file). CPU-bound nên dùng multiprocessing.',
    ],
  },
  {
    title: 'JavaScript ES6+ — Modern features cheatsheet',
    description:
      'Tóm tắt 20 features ES6+ quan trọng nhất: arrow function, destructuring, async/await, optional chaining, ...',
    subjectSlug: 'cs-programming',
    level: 'UNIVERSITY',
    docType: 'summary',
    tags: ['javascript', 'es6', 'modern'],
    fileFormat: 'pdf',
    pageCount: 15,
    badges: ['power_resource'],
    chunks: [
      'Arrow function: const f = (a, b) => a + b. Không có own `this`, không thể constructor.',
      'Destructuring: const { name, age = 18 } = user; default value nếu undefined.',
      'Optional chaining: user?.profile?.email — return undefined nếu intermediate null.',
    ],
  },
  {
    title: 'Văn 12 — Nghị luận xã hội đầy đủ dàn ý',
    description:
      '30 đề nghị luận xã hội thường gặp trong đề thi tốt nghiệp. Mỗi đề có dàn ý chi tiết + bài tham khảo.',
    subjectSlug: 'literature',
    level: 'HIGH_SCHOOL',
    grade: 12,
    docType: 'summary',
    tags: ['nghị luận', 'văn 12', 'dàn ý'],
    fileFormat: 'docx',
    pageCount: 45,
    badges: ['educator_approved'],
    chunks: [
      'Dàn ý nghị luận xã hội về 1 tư tưởng: 1) Giới thiệu vấn đề, 2) Giải thích, 3) Phân tích, 4) Bàn luận mở rộng, 5) Bài học cá nhân.',
      'Cách viết mở bài hay: dùng câu hỏi, danh ngôn, hoặc kể chuyện ngắn để dẫn dắt.',
    ],
  },
  {
    title: 'Tiếng Anh giao tiếp công sở — 100 tình huống',
    description:
      '100 tình huống thực tế ở công sở: meeting, email, phone call, small talk, ... Có dialog mẫu + key phrases.',
    subjectSlug: 'english',
    level: 'ADULT',
    docType: 'reference_book',
    tags: ['business english', 'giao tiếp', 'công sở'],
    fileFormat: 'pdf',
    pageCount: 100,
    badges: [],
    chunks: [
      'Meeting opener: "Thank you all for joining. Today\'s agenda has three items..."',
      'Disagreeing politely: "I see your point, however, I have a slightly different perspective..."',
      'Email closing: "Please let me know if you have any questions. Best regards,"',
    ],
  },
  {
    title: 'JLPT N5 — Kanji 100 chữ thông dụng',
    description:
      'Flashcard 100 kanji N5 với stroke order + on/kun reading + 3 ví dụ. Có quiz cuối mỗi bài 10 chữ.',
    subjectSlug: 'japanese',
    level: 'ADULT',
    docType: 'reference_book',
    tags: ['kanji', 'n5', 'jlpt'],
    fileFormat: 'pdf',
    pageCount: 50,
    badges: [],
    chunks: [
      '日 (NICHI/HI) — ngày, mặt trời. Ví dụ: 今日 (kyou) hôm nay, 日本 (Nihon) Nhật Bản.',
      '本 (HON/MOTO) — sách, gốc. Ví dụ: 本 (hon) sách, 日本 (Nihon).',
    ],
  },
  {
    title: 'Văn 11 — Phân tích Vợ chồng A Phủ',
    description:
      'Phân tích chi tiết tác phẩm "Vợ chồng A Phủ" của Tô Hoài. Bao gồm dàn ý + 3 bài mẫu band 9+.',
    subjectSlug: 'literature',
    level: 'HIGH_SCHOOL',
    grade: 11,
    docType: 'summary',
    tags: ['vợ chồng a phủ', 'tô hoài', 'phân tích'],
    fileFormat: 'docx',
    pageCount: 20,
    badges: [],
    chunks: [
      'Nhân vật Mị: từ cô gái yêu đời → tê liệt cam chịu → vùng dậy giải thoát. Biểu tượng sức sống tiềm tàng.',
      'Nhân vật A Phủ: thân phận nô lệ nhưng kiên cường, được Mị giải cứu — tạo nên cuộc gặp gỡ định mệnh.',
    ],
  },
];

async function resetSeed() {
  console.log('[reset] Đang xoá seed cũ...');
  const seeded = await db
    .select({ id: libraryDoc.id })
    .from(libraryDoc)
    .where(like(libraryDoc.fileUrl, `${SEED_PREFIX}%`));
  const ids = seeded.map((d) => d.id);
  if (ids.length === 0) {
    console.log('[reset] Không có seed cũ.');
    return;
  }
  await db.delete(libraryDoc).where(inArray(libraryDoc.id, ids));
  console.log(`[reset] Đã xoá ${ids.length} doc.`);
}

async function main() {
  if (RESET) {
    await resetSeed();
    process.exit(0);
  }

  console.log(`[seed] Tạo ${DOCS.length} docs realistic...`);

  const [anyUser] = await db.select({ id: user.id }).from(user).limit(1);
  if (!anyUser) {
    console.error('Không có user nào trong DB. Cần đăng ký user trước.');
    process.exit(1);
  }
  const uploaderId = anyUser.id;
  console.log(`[seed] Uploader: ${uploaderId}`);

  let insertedCount = 0;
  let chunkCount = 0;

  for (let i = 0; i < DOCS.length; i++) {
    const d = DOCS[i]!;
    const docId = randomUUID();

    const titleText = `${d.title}\n${d.description}`.slice(0, 4000);
    let titleEmb: number[] | null = null;
    if (!NO_EMBED) {
      try {
        titleEmb = await embedQuery(titleText);
      } catch (err) {
        console.error(`[embed-title-fail] ${d.title}`, (err as Error).message);
      }
    }

    await db.insert(libraryDoc).values({
      id: docId,
      uploaderId,
      title: d.title,
      description: d.description,
      subjectSlug: d.subjectSlug,
      level: d.level,
      grade: d.grade ?? null,
      docType: d.docType,
      examType: d.examType ?? null,
      schoolYear: d.schoolYear ?? null,
      region: 'national',
      language: 'vi',
      tags: d.tags,
      fileFormat: d.fileFormat,
      fileSizeBytes: d.pageCount * 80 * 1024,
      fileUrl: `${SEED_PREFIX}${d.fileFormat}/${docId}`,
      fileHash: `seed-${docId}`,
      pageCount: d.pageCount,
      previewThumbUrl: null,
      aiSummary: d.description,
      aiSummaryAt: new Date(),
      previewText: d.chunks.join(' ').slice(0, 500),
      titleEmbedding: titleEmb,
      license: 'CC-BY-4.0',
      status: 'PUBLISHED',
      ratingAvg: Math.random() > 0.3 ? String((4 + Math.random()).toFixed(2)) : null,
      ratingCount: Math.floor(Math.random() * 80),
      viewCount: Math.floor(Math.random() * 500),
      downloadCount: Math.floor(Math.random() * 200),
      workspaceImportCount: Math.floor(Math.random() * 100),
      qualityScore: String((50 + Math.random() * 40).toFixed(2)),
      badges: d.badges,
    });

    if (d.chunks.length > 0 && !NO_EMBED) {
      try {
        const embeddings = await embedBatch(d.chunks);
        await db.insert(libraryDocChunk).values(
          d.chunks.map((content, idx) => ({
            id: randomUUID(),
            docId,
            pageNum: Math.floor(idx / 2) + 1,
            chunkIndex: idx,
            content,
            contentVec: embeddings[idx] ?? null,
          })),
        );
        chunkCount += d.chunks.length;
      } catch (err) {
        console.error(`[embed-chunks-fail] ${d.title}`, (err as Error).message);
      }
    }

    insertedCount++;
    if ((i + 1) % 5 === 0) console.log(`  ${i + 1}/${DOCS.length}`);
  }

  console.log(`\n[done] Seed Library V1 complete!`);
  console.log(`  Docs inserted: ${insertedCount}`);
  console.log(`  Chunks inserted: ${chunkCount}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('[seed-fatal]', err);
  process.exit(1);
});
