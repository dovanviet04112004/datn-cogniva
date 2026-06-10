/**
 * GoalPlannerService — port từ apps/web/src/lib/library/goal-planner.ts
 * (Pillar #1): parse mục tiêu user (LLM) → StudyGoal → chia tuần theo cluster
 * curated → search library docs cho từng tuần (hybrid search matchMode 'or').
 * Prompt + cluster blueprint + summary deterministic GIỮ NGUYÊN VĂN.
 */
import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { HybridSearchService, type LibraryDocResult } from './hybrid-search.service';
import { LibraryLlmService, type Plan } from './library-llm.service';

export type StudyGoal = {
  subjectSlug: string;
  level: string;
  grade?: number;
  /** Loại mục tiêu — graduation_exam / university_entrance / general_review / new_topic */
  goalType: 'graduation_exam' | 'university_entrance' | 'gifted_student' | 'general_review' | 'new_topic';
  /** Thời gian khả dụng tính bằng tuần. */
  deadlineWeeks: number;
  /** Điểm hiện tại (0-10). */
  currentScore?: number;
  /** Điểm mục tiêu (0-10). */
  targetScore?: number;
  /** Tổng giờ học/tuần khả dụng. */
  hoursPerWeek?: number;
  /** Cluster topic ưu tiên user mention (sẽ ưu tiên trong plan). */
  focusTopics?: string[];
};

export type WeeklyPlan = {
  weekNum: number;
  title: string;
  topics: string[];
  estimatedHours: number;
  /** Doc IDs đề xuất cho tuần này — theo doc_type cluster. */
  recommendedDocs: {
    theory: LibraryDocResult[];
    exercise: LibraryDocResult[];
    exam: LibraryDocResult[];
  };
};

export type StudyPlanResult = {
  goal: StudyGoal;
  /** Câu mở đầu giải thích plan (deterministic, không LLM). */
  summary: string;
  weeks: WeeklyPlan[];
};

// ─── Parse goal từ user input ────────────────────────────────────────
const GOAL_SCHEMA = z.object({
  subjectSlug: z.string(),
  level: z.string(),
  grade: z.number().optional(),
  goalType: z.enum([
    'graduation_exam',
    'university_entrance',
    'gifted_student',
    'general_review',
    'new_topic',
  ]),
  deadlineWeeks: z.number().min(1).max(52),
  currentScore: z.number().optional(),
  targetScore: z.number().optional(),
  hoursPerWeek: z.number().optional(),
  focusTopics: z.array(z.string()).optional(),
});

const GOAL_PARSER_SYSTEM = `Bạn parse mục tiêu học tập tiếng Việt thành JSON.

Output BẮT BUỘC JSON:
{
  "subjectSlug": "math|physics|chemistry|literature|english|english-ielts|english-toeic|cs-programming|japanese|...",
  "level": "PRIMARY|SECONDARY|HIGH_SCHOOL|UNIVERSITY|ADULT",
  "grade": 10-12 (nếu mention "lớp X"),
  "goalType": "graduation_exam|university_entrance|gifted_student|general_review|new_topic",
  "deadlineWeeks": số tuần,
  "currentScore": điểm hiện tại 0-10 (nếu mention),
  "targetScore": điểm mục tiêu 0-10 (nếu mention),
  "hoursPerWeek": giờ/tuần (nếu mention),
  "focusTopics": ["topic 1", "topic 2"] (nếu mention)
}

QUY TẮC:
- "tốt nghiệp THPT" → goalType=graduation_exam
- "đại học" / "khối A/B/D" → goalType=university_entrance
- "thi học sinh giỏi" → goalType=gifted_student
- "ôn lại" / "củng cố" → goalType=general_review
- "học mới" / "từ đầu" → goalType=new_topic
- "4 tuần" → deadlineWeeks=4
- "1 tháng" → deadlineWeeks=4
- "3 tháng" → deadlineWeeks=12
- "lớp 12" → level=HIGH_SCHOOL, grade=12
- "ĐH" → level=UNIVERSITY
- Default deadlineWeeks=8 nếu user không nói

CHỈ trả JSON, không markdown.`;

// ─── Topic clusters cho mỗi subject (curated theo syllabus VN) ────────
const SUBJECT_CLUSTERS: Record<string, Array<{ title: string; topics: string[] }>> = {
  math: [
    { title: 'Đạo hàm + ứng dụng', topics: ['đạo hàm', 'hàm bậc 1-3', 'cực trị', 'tiệm cận'] },
    { title: 'Tích phân + ứng dụng', topics: ['tích phân', 'tích phân từng phần', 'diện tích', 'thể tích'] },
    { title: 'Số phức', topics: ['số phức', 'modulus', 'phương trình bậc 2 phức'] },
    { title: 'Hàm mũ & logarit', topics: ['hàm mũ', 'logarit', 'phương trình mũ', 'bất phương trình'] },
    { title: 'Hình học không gian Oxyz', topics: ['toạ độ', 'đường thẳng', 'mặt phẳng', 'mặt cầu'] },
    { title: 'Xác suất + tổ hợp', topics: ['xác suất', 'hoán vị', 'chỉnh hợp', 'tổ hợp'] },
  ],
  physics: [
    { title: 'Cơ học', topics: ['dao động', 'sóng cơ', 'va chạm'] },
    { title: 'Điện học', topics: ['dòng điện', 'từ trường', 'cảm ứng điện từ'] },
    { title: 'Sóng & quang', topics: ['sóng ánh sáng', 'giao thoa', 'tán sắc'] },
    { title: 'Hạt nhân & lượng tử', topics: ['photon', 'phóng xạ', 'hạt nhân'] },
  ],
  chemistry: [
    { title: 'Hữu cơ', topics: ['ester', 'lipit', 'amino acid', 'protein'] },
    { title: 'Vô cơ', topics: ['kim loại', 'phi kim', 'oxi hoá khử'] },
    { title: 'Điện phân & ăn mòn', topics: ['điện phân', 'ăn mòn', 'pin điện hoá'] },
  ],
  'english-ielts': [
    { title: 'Speaking strategy', topics: ['speaking', 'fluency', 'pronunciation'] },
    { title: 'Writing Task 1', topics: ['writing task 1', 'chart description', 'data analysis'] },
    { title: 'Writing Task 2', topics: ['writing task 2', 'essay structure', 'argument'] },
    { title: 'Reading skills', topics: ['reading', 'skimming', 'scanning', 'TFNG'] },
    { title: 'Listening + accent', topics: ['listening', 'note taking', 'multiple choice'] },
  ],
  english: [
    { title: 'Grammar core', topics: ['tenses', 'conditionals', 'modals'] },
    { title: 'Vocabulary building', topics: ['vocabulary', 'phrasal verbs', 'idioms'] },
    { title: 'Reading + writing', topics: ['reading', 'essay writing'] },
    { title: 'Speaking + listening', topics: ['conversation', 'pronunciation'] },
  ],
  'english-toeic': [
    { title: 'Listening (P1-P4)', topics: ['listening', 'photo description', 'short talks'] },
    { title: 'Reading (P5-P7)', topics: ['reading', 'incomplete sentences', 'text completion'] },
    { title: 'Mock test strategy', topics: ['time management', 'guessing strategy'] },
  ],
  'cs-programming': [
    { title: 'Cú pháp cơ bản', topics: ['syntax', 'variables', 'control flow'] },
    { title: 'Cấu trúc dữ liệu', topics: ['array', 'list', 'dictionary', 'tree'] },
    { title: 'Thuật toán', topics: ['sorting', 'searching', 'recursion'] },
    { title: 'Project thực hành', topics: ['project', 'web app', 'API'] },
  ],
};

@Injectable()
export class GoalPlannerService {
  constructor(
    private readonly hybridSearch: HybridSearchService,
    private readonly libraryLlm: LibraryLlmService,
  ) {}

  async parseGoal({
    userMessage,
    userId,
    plan,
  }: {
    userMessage: string;
    userId: string;
    plan: Plan;
  }): Promise<StudyGoal> {
    try {
      const text = await this.libraryLlm.guardedComplete({
        userId,
        plan,
        system: GOAL_PARSER_SYSTEM,
        prompt: `Mục tiêu user:\n${userMessage}\n\nTrả JSON.`,
        maxTokens: 300,
        feature: 'library.goal.parse',
      });
      const cleaned = text
        .trim()
        .replace(/^```(?:json)?\s*/, '')
        .replace(/\s*```$/, '');
      const raw = JSON.parse(cleaned) as Record<string, unknown>;
      // LLM hay trả null cho field không biết (thay vì bỏ) → Zod .optional() từ
      // chối null. Strip null để field optional thành undefined, parse mới qua.
      for (const k of Object.keys(raw)) if (raw[k] === null) delete raw[k];
      return GOAL_SCHEMA.parse(raw);
    } catch (err) {
      console.error('[parseGoal]', err);
      // Fallback — best-effort default
      return {
        subjectSlug: 'math',
        level: 'HIGH_SCHOOL',
        goalType: 'general_review',
        deadlineWeeks: 8,
      };
    }
  }

  /**
   * Build kế hoạch tuần dựa trên goal + library docs available.
   * Strategy: chọn N cluster phù hợp goalType, chia đều thời gian, ưu tiên
   * focusTopics nếu user mention, search library 3 categories mỗi cluster.
   */
  async buildStudyPlan(goal: StudyGoal): Promise<StudyPlanResult> {
    let clusters = SUBJECT_CLUSTERS[goal.subjectSlug] ?? [
      { title: 'Tổng quan', topics: [goal.subjectSlug] },
    ];

    // Ưu tiên focusTopics user mention — bring matching clusters lên đầu
    if (goal.focusTopics && goal.focusTopics.length > 0) {
      const focusLower = goal.focusTopics.map((t) => t.toLowerCase());
      clusters = [...clusters].sort((a, b) => {
        const aHit = a.topics.some((t) => focusLower.some((f) => t.toLowerCase().includes(f) || f.includes(t.toLowerCase())));
        const bHit = b.topics.some((t) => focusLower.some((f) => t.toLowerCase().includes(f) || f.includes(t.toLowerCase())));
        if (aHit && !bHit) return -1;
        if (!aHit && bHit) return 1;
        return 0;
      });
    }

    // Adapt # clusters theo goalType
    const weeksAvailable = goal.deadlineWeeks;
    let plannedClusters = clusters.slice(0, weeksAvailable);
    // Nếu < cluster có sẵn, cluster cuối là "Đề thi thử full" cho graduation
    if (
      plannedClusters.length < clusters.length &&
      (goal.goalType === 'graduation_exam' || goal.goalType === 'university_entrance')
    ) {
      plannedClusters = clusters.slice(0, weeksAvailable - 1);
      plannedClusters.push({
        title: 'Đề thi thử & ôn tập tổng hợp',
        topics: ['đề thi thử', 'mock exam', 'tổng hợp'],
      });
    }

    const hoursPerWeek = goal.hoursPerWeek ?? 10;

    // Search docs cho mỗi cluster parallel
    const weeklyResults = await Promise.all(
      plannedClusters.map(async (cluster, idx) => {
        // Recommendation → ưu tiên RECALL: chỉ hard-filter theo subject (+ngôn
        // ngữ), KHÔNG lọc level/grade (LLM hay parse sai → loại nhầm hết doc).
        // matchMode='or' vì query là cụm nhiều topic — AND mọi token thì gần như
        // 0 doc khớp đủ; OR + ts_rank vẫn đẩy doc liên quan nhất lên đầu.
        const baseFilter = {
          subjectSlug: goal.subjectSlug,
          language: 'vi',
        };
        const query = cluster.topics.join(' ');
        const [theoryRes, exerciseRes, examRes] = await Promise.all([
          this.hybridSearch.hybridSearchLibraryDocs({
            query,
            filters: { ...baseFilter, docType: ['lecture_notes', 'summary', 'reference_book'] },
            matchMode: 'or',
            sort: 'top',
            limit: 3,
          }),
          this.hybridSearch.hybridSearchLibraryDocs({
            query,
            filters: { ...baseFilter, docType: ['exercise', 'solution'] },
            matchMode: 'or',
            sort: 'top',
            limit: 3,
          }),
          this.hybridSearch.hybridSearchLibraryDocs({
            query,
            filters: { ...baseFilter, docType: ['exam'] },
            matchMode: 'or',
            sort: 'top',
            limit: 2,
          }),
        ]);
        return {
          weekNum: idx + 1,
          title: cluster.title,
          topics: cluster.topics,
          estimatedHours: hoursPerWeek,
          recommendedDocs: {
            theory: theoryRes.items,
            exercise: exerciseRes.items,
            exam: examRes.items,
          },
        } satisfies WeeklyPlan;
      }),
    );

    // Build summary deterministic
    const subjectLabel = labelForSubject(goal.subjectSlug);
    const summary = buildSummary(goal, subjectLabel, plannedClusters.length);

    return {
      goal,
      summary,
      weeks: weeklyResults,
    };
  }
}

function buildSummary(goal: StudyGoal, subjectLabel: string, weekCount: number): string {
  const parts: string[] = [];
  parts.push(`Kế hoạch ${weekCount} tuần học ${subjectLabel}`);
  if (goal.grade) parts.push(`lớp ${goal.grade}`);
  if (goal.targetScore && goal.currentScore) {
    parts.push(`mục tiêu ${goal.currentScore} → ${goal.targetScore} điểm`);
  } else if (goal.targetScore) {
    parts.push(`mục tiêu ${goal.targetScore} điểm`);
  }
  const goalTypeLabel: Record<StudyGoal['goalType'], string> = {
    graduation_exam: 'ôn thi tốt nghiệp THPT',
    university_entrance: 'ôn thi đại học',
    gifted_student: 'luyện học sinh giỏi',
    general_review: 'củng cố kiến thức',
    new_topic: 'học chủ đề mới',
  };
  parts.push(`(${goalTypeLabel[goal.goalType]})`);
  return parts.join(' · ');
}

function labelForSubject(slug: string): string {
  const map: Record<string, string> = {
    math: 'Toán',
    physics: 'Vật Lý',
    chemistry: 'Hoá học',
    literature: 'Văn',
    english: 'Tiếng Anh',
    'english-ielts': 'IELTS',
    'english-toeic': 'TOEIC',
    'cs-programming': 'Lập trình',
    japanese: 'Tiếng Nhật',
  };
  return map[slug] ?? slug;
}
