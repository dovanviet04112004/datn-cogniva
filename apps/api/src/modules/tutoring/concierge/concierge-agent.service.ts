import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { CostGuardrailService, type Plan } from '../../../infra/ai/cost-guardrail.service';
import { LlmService } from '../../../infra/ai/llm.service';
import { ALL_SUBJECTS, SUBJECT_BY_SLUG, type SubjectLevel } from '../../../common/subject-taxonomy';
import type { HybridSearchResult } from './tutor-search.service';
import { inferLevelFromText, inferSubjectFromText } from './subject-infer';

export type { Plan };

export type ConciergeFilters = {
  subjectSlug?: string;
  level?: string;
  budgetMaxVnd?: number;
  modality?: 'ONLINE' | 'OFFLINE_HN' | 'OFFLINE_HCM' | 'HYBRID';
  keywords?: string[];
};

export type ConciergeRole = 'student' | 'tutor';

export type ConciergeAction =
  | { type: 'clarify'; question: string; chips?: string[]; role?: ConciergeRole }
  | {
      type: 'search';
      role: ConciergeRole;
      searchTarget: 'tutor' | 'request';
      filters: ConciergeFilters;
      reason?: string;
    }
  | {
      type: 'no_match';
      role: ConciergeRole;
      searchTarget: 'tutor' | 'request';
      filters: ConciergeFilters;
    }
  | {
      type: 'tutor_detail';
      role: ConciergeRole;
      tutorRef: string;
      askAbout: 'reviews' | 'availability' | 'price' | 'profile' | 'other';
    }
  | {
      type: 'faq';
      role: ConciergeRole;
      query: string;
    }
  | {
      type: 'library_search';
      role: ConciergeRole;
      query: string;
      filters: {
        subjectSlug?: string;
        level?: string;
        grade?: number;
        docType?: string[];
      };
    };

export type ConciergeHistory = Array<{
  role: 'user' | 'assistant';
  content: string;
}>;

const PLANNER_SCHEMA = z.object({
  role: z.enum(['student', 'tutor']).optional(),
  action: z.enum(['clarify', 'search', 'tutor_detail', 'faq', 'library_search']),
  question: z.string().optional(),
  chips: z.array(z.string()).optional(),
  filters: z
    .object({
      subjectSlug: z.string().optional(),
      level: z.string().optional(),
      budgetMaxVnd: z.number().optional(),
      modality: z.enum(['ONLINE', 'OFFLINE_HN', 'OFFLINE_HCM', 'HYBRID']).optional(),
      keywords: z.array(z.string()).optional(),
    })
    .optional(),
  reason: z.string().optional(),
  tutorRef: z.string().optional(),
  askAbout: z.enum(['reviews', 'availability', 'price', 'profile', 'other']).optional(),
  faqQuery: z.string().optional(),
  libraryQuery: z.string().optional(),
  libraryGrade: z.number().optional(),
  libraryDocType: z.array(z.string()).optional(),
});

function inferRoleFromHistory(history: ConciergeHistory): ConciergeRole {
  const tutorPatterns = [
    /tôi\s*(là|đang là)\s*(gia\s*sư|tutor|giáo\s*viên)/i,
    /tôi\s*muốn\s*dạy/i,
    /tìm\s*(học\s*sinh|học\s*viên|ứng\s*viên|lead)/i,
    /tôi\s*đang\s*dạy/i,
    /có\s*(yêu\s*cầu|job|đơn)\s*nào/i,
  ];
  for (const m of history) {
    if (m.role !== 'user') continue;
    for (const p of tutorPatterns) {
      if (p.test(m.content)) return 'tutor';
    }
  }
  return 'student';
}

function compactSubjectList(): string {
  return ALL_SUBJECTS.slice(0, 40)
    .map((s) => `${s.slug}=${s.name}`)
    .join(', ');
}

const PLANNER_SYSTEM = `Bạn là planner cho AI Concierge marketplace gia sư Cogniva.

NHIỆM VỤ: Đọc lịch sử + last user message + filter cũ → trả 1 JSON action. CHỈ JSON, KHÔNG markdown.

Cấu trúc JSON:
{
  "role": "student" | "tutor",
  "action": "clarify" | "search",
  "question": "câu hỏi clarify (chỉ khi action=clarify)",
  "chips": ["gợi ý 1", "gợi ý 2"],
  "filters": {
    "subjectSlug": "math|physics|english|...",
    "level": "PRIMARY|SECONDARY|HIGH_SCHOOL|UNIVERSITY|ADULT",
    "budgetMaxVnd": 200000,
    "modality": "ONLINE|OFFLINE_HN|OFFLINE_HCM|HYBRID",
    "keywords": ["luyện đề","nâng cao"]
  },
  "reason": "< 60 ký tự (khi action=search)"
}

ROLE DETECTION (BẮT BUỘC làm trước):
- role="tutor" KHI user nói: "tôi là gia sư", "tôi là tutor", "tôi đang dạy", "tìm học sinh", "tìm học viên", "tìm ứng viên", "tìm lead", "có yêu cầu nào", "có job nào", "tôi muốn dạy".
- role="student" mọi trường hợp khác (default): "tôi muốn học", "cần học", "cần gia sư", "top gia sư X", "có gia sư nào".
- Nếu mơ hồ → role="student" (default an toàn hơn).

QUY TẮC TỐI THƯỢNG:
1. Chỉ được clarify để hỏi MÔN HỌC (subjectSlug). KHÔNG hỏi level, modality, budget, lịch — search trước, user lọc sau.
2. Khi ĐÃ có subjectSlug (từ message HOẶC filter cũ) → BẮT BUỘC action=search. Level optional.
3. action search áp dụng cho cả 2 role: backend tự branch sang search tutor (student) hoặc search request (tutor) dựa vào role field.
4. KHÔNG được dùng action="no_match" — backend tự handle dựa vào kết quả search thực tế.
5. action="tutor_detail" khi user hỏi sâu về 1 GIA SƯ CỤ THỂ đã shown trong thread. Trigger words:
   - "review/đánh giá/feedback về {tên}" → askAbout=reviews
   - "lịch/giờ rảnh/dạy buổi {nào} của {tên}" → askAbout=availability
   - "giá/học phí/pack của {tên}" → askAbout=price
   - "chi tiết/thêm về/profile {tên}" → askAbout=profile
   - Câu hỏi khác về 1 tutor cụ thể → askAbout=other
   tutorRef = tên hoặc fragment user gõ ("cô Mai", "thầy David", "tutor số 2"). Backend sẽ fuzzy match.

6. action="library_search" khi user hỏi TÀI LIỆU / DOC / SÁCH / ĐỀ / NOTES — KHÔNG phải gia sư. Trigger words:
   - "tài liệu/doc/sách/đề thi/đề cương/bài giảng/notes/PDF/slide" + môn
   - "tìm tài liệu Toán 12" → libraryQuery="Toán 12", subjectSlug=math, libraryGrade=12
   - "có đề thi IELTS không" → libraryQuery="đề thi IELTS", subjectSlug=english-ielts, libraryDocType=["exam"]
   - "đề cương Hoá lớp 11" → libraryQuery="đề cương Hoá", libraryDocType=["summary"], grade=11
   - "có tài liệu nào về đạo hàm không" → libraryQuery="đạo hàm", subjectSlug=math
   - libraryDocType options: lecture_notes/summary/exam/exercise/solution/reference_book

7. action="faq" khi user hỏi POLICY hoặc PROCESS chung của platform (KHÔNG về 1 tutor cụ thể, KHÔNG phải search). Trigger words bao gồm:
   - "trial là gì / buổi thử miễn phí không"
   - "huỷ buổi / refund / hoàn tiền / cancel"
   - "thanh toán / nạp ví / vnpay / momo"
   - "pack giảm bao nhiêu / combo / mua nhiều"
   - "hoa hồng / commission / cogniva lấy bao nhiêu %"
   - "rút tiền / payout / withdraw"
   - "kyc / xác minh / cccd / verified bao lâu"
   - "tăng visibility / nhiều lead / ranking"
   - "instant book / đặt ngay là gì"
   - "support / liên hệ / help"
   - "cogniva là gì / how it works / cách hoạt động"
   - "giá trung bình môn X / mức giá thị trường"
   - "cách chọn gia sư tốt / nên chọn ai"
   faqQuery = câu hỏi nguyên gốc user gõ (để backend match keywords).

MAPPING TỪ VIỆT → FIELDS (suy luận thông minh, KHÔNG cần hỏi):
- "lớp 1-5" / "tiểu học" → level=PRIMARY
- "lớp 6-9" / "THCS" / "cấp 2" → level=SECONDARY
- "lớp 10-12" / "lớp 10" / "lớp 11" / "lớp 12" / "THPT" / "cấp 3" → level=HIGH_SCHOOL
- "đại học" / "ĐH" / "sinh viên" → level=UNIVERSITY
- "đi làm" / "người lớn" / "IELTS" / "TOEIC" → ADULT
- "toán" → math, "lý" → physics, "hoá" → chemistry, "văn" → literature, "anh" / "english" → english, "lập trình" / "code" → cs-programming
- Modality CHỈ extract nếu user gõ trực tiếp ("online" / "trực tuyến" → ONLINE; "tại Hà Nội" → OFFLINE_HN; "tại HCM" → OFFLINE_HCM). KHÔNG hỏi.
- Budget CHỈ extract nếu user gõ số ("200k" → 200000, "dưới 150k" → 150000). KHÔNG hỏi.

subjectSlug pick từ list: ${compactSubjectList()}

VÍ DỤ STUDENT:
User: "toán 12"
→ {"role":"student","action":"search","filters":{"subjectSlug":"math","level":"HIGH_SCHOOL"},"reason":"Toán THPT lớp 12"}

User: "top các gia sư toán có trong hệ thống"
→ {"role":"student","action":"search","filters":{"subjectSlug":"math","keywords":["top"]},"reason":"Top gia sư Toán"}

User: "có gia sư IELTS nào không"
→ {"role":"student","action":"search","filters":{"subjectSlug":"english-ielts"},"reason":"Browse gia sư IELTS"}

User: "muốn học gia sư"
→ {"role":"student","action":"clarify","question":"Bạn muốn học môn gì?","chips":["Toán","Tiếng Anh","Vật lý","Lập trình"]}

User: "ielts speaking 6.5"
→ {"role":"student","action":"search","filters":{"subjectSlug":"english-ielts","level":"ADULT","keywords":["speaking","6.5"]},"reason":"IELTS speaking 6.5+"}

User: "toán cấp 3, online, 200k"
→ {"role":"student","action":"search","filters":{"subjectSlug":"math","level":"HIGH_SCHOOL","modality":"ONLINE","budgetMaxVnd":200000},"reason":"Toán THPT online <200k"}

VÍ DỤ TUTOR (search REQUESTS):
User: "tôi là gia sư toán cần tìm ứng viên"
→ {"role":"tutor","action":"search","filters":{"subjectSlug":"math"},"reason":"Yêu cầu học Toán"}

User: "tôi là gia sư IELTS, có yêu cầu nào không?"
→ {"role":"tutor","action":"search","filters":{"subjectSlug":"english-ielts"},"reason":"Yêu cầu học IELTS"}

User: "tôi đang dạy Lý THPT, tìm học sinh"
→ {"role":"tutor","action":"search","filters":{"subjectSlug":"physics","level":"HIGH_SCHOOL"},"reason":"Yêu cầu Lý THPT"}

User: "tôi muốn dạy"
→ {"role":"tutor","action":"clarify","question":"Bạn dạy môn gì để mình tìm yêu cầu phù hợp?","chips":["Toán","Lý","Hoá","IELTS","Lập trình"]}

User reply "?" (sau khi bot hỏi môn)
→ {"role":"student","action":"clarify","question":"Bạn muốn học môn gì? Bấm chip hoặc gõ tự do.","chips":["Toán","Hoá","IELTS","Lập trình"]}

VÍ DỤ TUTOR_DETAIL (deep Q&A — chỉ khi user hỏi sâu về 1 tutor cụ thể):
User: "review về cô Mai thì sao"
→ {"role":"student","action":"tutor_detail","tutorRef":"cô Mai","askAbout":"reviews"}

User: "thầy David có dạy buổi tối không"
→ {"role":"student","action":"tutor_detail","tutorRef":"thầy David","askAbout":"availability"}

User: "giá của tutor số 2"
→ {"role":"student","action":"tutor_detail","tutorRef":"tutor số 2","askAbout":"price"}

User: "cho mình xem chi tiết hơn về cô Hương"
→ {"role":"student","action":"tutor_detail","tutorRef":"cô Hương","askAbout":"profile"}

VÍ DỤ LIBRARY_SEARCH (tìm tài liệu, doc, đề thi):
User: "tìm tài liệu Toán lớp 12 đạo hàm"
→ {"role":"student","action":"library_search","libraryQuery":"Toán 12 đạo hàm","filters":{"subjectSlug":"math","level":"HIGH_SCHOOL"},"libraryGrade":12}

User: "có đề thi IELTS Writing không"
→ {"role":"student","action":"library_search","libraryQuery":"đề thi IELTS Writing","filters":{"subjectSlug":"english-ielts"},"libraryDocType":["exam"]}

User: "đề cương Hoá lớp 11"
→ {"role":"student","action":"library_search","libraryQuery":"đề cương Hoá","filters":{"subjectSlug":"chemistry","level":"HIGH_SCHOOL"},"libraryGrade":11,"libraryDocType":["summary"]}

User: "có sách Python cho người mới"
→ {"role":"student","action":"library_search","libraryQuery":"Python beginner","filters":{"subjectSlug":"cs-programming"},"libraryDocType":["reference_book","lecture_notes"]}

VÍ DỤ FAQ (platform-level Q&A):
User: "trial có free không"
→ {"role":"student","action":"faq","faqQuery":"trial có free không"}

User: "huỷ buổi được hoàn tiền ko"
→ {"role":"student","action":"faq","faqQuery":"huỷ buổi được hoàn tiền"}

User: "cách nạp ví thế nào"
→ {"role":"student","action":"faq","faqQuery":"cách nạp ví"}

User: "cogniva lấy hoa hồng bao nhiêu" (tutor)
→ {"role":"tutor","action":"faq","faqQuery":"cogniva lấy hoa hồng"}

User: "kyc bao lâu duyệt"
→ {"role":"tutor","action":"faq","faqQuery":"kyc bao lâu"}

User: "cách rút tiền"
→ {"role":"tutor","action":"faq","faqQuery":"cách rút tiền"}

User: "giá Toán THPT trung bình bao nhiêu"
→ {"role":"student","action":"faq","faqQuery":"giá Toán THPT trung bình"}
`;

export function validateFilters(filters: ConciergeFilters): {
  valid: boolean;
  cleaned: ConciergeFilters;
} {
  const cleaned: ConciergeFilters = {};
  if (filters.subjectSlug && SUBJECT_BY_SLUG[filters.subjectSlug]) {
    cleaned.subjectSlug = filters.subjectSlug;
  }
  if (filters.level) {
    const validLevels: SubjectLevel[] = [
      'PRIMARY',
      'SECONDARY',
      'HIGH_SCHOOL',
      'UNIVERSITY',
      'ADULT',
    ];
    if (validLevels.includes(filters.level as SubjectLevel)) {
      cleaned.level = filters.level;
    }
  }
  if (filters.budgetMaxVnd && filters.budgetMaxVnd > 0) {
    cleaned.budgetMaxVnd = filters.budgetMaxVnd;
  }
  if (filters.modality) cleaned.modality = filters.modality;
  if (filters.keywords && filters.keywords.length > 0) {
    cleaned.keywords = filters.keywords.slice(0, 5);
  }

  return {
    valid: !!cleaned.subjectSlug,
    cleaned,
  };
}

@Injectable()
export class ConciergeAgentService {
  constructor(
    private readonly llm: LlmService,
    private readonly guardrail: CostGuardrailService,
  ) {}

  async planConciergeStep({
    history,
    currentFilters,
    userId,
    plan,
  }: {
    history: ConciergeHistory;
    currentFilters?: ConciergeFilters;
    userId: string;
    plan: Plan;
  }): Promise<ConciergeAction> {
    const lastUser = [...history].reverse().find((m) => m.role === 'user');
    if (!lastUser) {
      return {
        type: 'clarify',
        question: 'Bạn muốn học môn gì?',
        chips: ['Toán', 'Vật lý', 'IELTS', 'Lập trình'],
        role: 'student',
      };
    }

    const recent = history.slice(-8);
    const historyText = recent
      .map((m) => `${m.role === 'user' ? 'User' : 'AI'}: ${m.content}`)
      .join('\n');

    const filtersText = currentFilters
      ? `\nFilter hiện tại: ${JSON.stringify(currentFilters)}`
      : '';

    const userPrompt = `Lịch sử:\n${historyText}${filtersText}\n\nTrả JSON action.`;

    const text = await this.guardedComplete({
      userId,
      plan,
      system: PLANNER_SYSTEM,
      prompt: userPrompt,
      maxTokens: 300,
      feature: 'tutoring.concierge.planner',
    });

    const cleaned = text
      .trim()
      .replace(/^```(?:json)?\s*/, '')
      .replace(/\s*```$/, '');

    try {
      const parsed = PLANNER_SCHEMA.parse(JSON.parse(cleaned));
      const role: ConciergeRole = parsed.role ?? inferRoleFromHistory(history);
      const searchTarget = role === 'tutor' ? 'request' : 'tutor';

      if (parsed.action === 'clarify') {
        const inferredSubject =
          inferSubjectFromText(lastUser.content) ?? currentFilters?.subjectSlug ?? null;
        const inferredLevel = inferLevelFromText(lastUser.content) ?? currentFilters?.level ?? null;
        if (inferredSubject) {
          return {
            type: 'search',
            role,
            searchTarget,
            filters: {
              subjectSlug: inferredSubject,
              level: inferredLevel ?? undefined,
              keywords: [],
            },
            reason: 'Override planner — subject inferred',
          };
        }
        return {
          type: 'clarify',
          question: parsed.question ?? 'Bạn cho mình biết thêm chi tiết?',
          chips: parsed.chips,
          role,
        };
      }
      if (parsed.action === 'tutor_detail') {
        if (!parsed.tutorRef) {
          return {
            type: 'clarify',
            question: 'Bạn muốn hỏi về gia sư nào?',
            chips: ['Cô Mai', 'Thầy David'],
            role,
          };
        }
        return {
          type: 'tutor_detail',
          role,
          tutorRef: parsed.tutorRef,
          askAbout: parsed.askAbout ?? 'other',
        };
      }
      if (parsed.action === 'faq') {
        const lastUserMsg = [...history].reverse().find((m) => m.role === 'user')?.content ?? '';
        return {
          type: 'faq',
          role,
          query: parsed.faqQuery ?? lastUserMsg,
        };
      }
      if (parsed.action === 'library_search') {
        const lastUserMsg = [...history].reverse().find((m) => m.role === 'user')?.content ?? '';
        return {
          type: 'library_search',
          role,
          query: parsed.libraryQuery ?? lastUserMsg,
          filters: {
            subjectSlug: parsed.filters?.subjectSlug,
            level: parsed.filters?.level,
            grade: parsed.libraryGrade,
            docType: parsed.libraryDocType,
          },
        };
      }
      return {
        type: 'search',
        role,
        searchTarget,
        filters: (parsed.filters as ConciergeFilters) ?? {},
        reason: parsed.reason,
      };
    } catch {
      return {
        type: 'clarify',
        question: 'Bạn cho mình biết môn học + cấp độ cụ thể nhé?',
        chips: ['Toán THPT', 'IELTS', 'Lập trình', 'Tiếng Anh giao tiếp'],
        role: 'student',
      };
    }
  }

  async generateMatchReasons({
    tutors,
    userQuery,
    filters,
    userId,
    plan,
  }: {
    tutors: HybridSearchResult[];
    userQuery: string;
    filters: ConciergeFilters;
    userId: string;
    plan: Plan;
  }): Promise<Map<string, string>> {
    if (tutors.length === 0) return new Map();

    const subjectName = filters.subjectSlug
      ? (SUBJECT_BY_SLUG[filters.subjectSlug]?.name ?? filters.subjectSlug)
      : '';

    const tutorList = tutors
      .map(
        (t, i) =>
          `[${i}] ID:${t.id} · "${t.headline}" · ${t.hourlyRateVnd / 1000}k/h · rating ${t.ratingAvg ?? '?'}\nBio (60 chars): ${t.bio.slice(0, 60)}`,
      )
      .join('\n\n');

    const system = `Bạn viết 1 câu lý do (< 20 từ, tiếng Việt) giải thích vì sao mỗi gia sư match query của user.

Format BẮT BUỘC: 1 dòng / tutor, dạng "INDEX|reason".
VÍ DỤ:
0|Chuyên luyện đề trắc nghiệm Toán THPT, rating 4.9
1|Giảng viên ĐH Lý, kinh nghiệm dạy IELTS Physics 5 năm

KHÔNG markdown, KHÔNG header, KHÔNG line thừa.`;

    const userPrompt = `Query: ${userQuery}\nMôn: ${subjectName}\nKeywords: ${(filters.keywords ?? []).join(', ') || '(none)'}\n\nDanh sách gia sư:\n${tutorList}\n\nViết lý do cho từng tutor.`;

    const text = await this.guardedComplete({
      userId,
      plan,
      system,
      prompt: userPrompt,
      maxTokens: 500,
      feature: 'tutoring.concierge.match-reason',
    });

    const reasons = new Map<string, string>();
    for (const line of text.split('\n')) {
      const m = line.trim().match(/^(\d+)\s*[|│]\s*(.+)$/);
      if (!m) continue;
      const idx = Number(m[1]);
      const reason = m[2]?.trim();
      if (Number.isInteger(idx) && tutors[idx] && reason) {
        reasons.set(tutors[idx]!.id, reason);
      }
    }
    return reasons;
  }

  private async guardedComplete(args: {
    userId: string;
    plan: Plan;
    system: string;
    prompt: string;
    maxTokens: number;
    feature: string;
  }): Promise<string> {
    const pm = this.pickModelForCost();
    const inputTokens = Math.ceil((args.system.length + args.prompt.length) / 3);
    const estimatedCostUsd =
      (inputTokens * pm.inputPerM + args.maxTokens * pm.outputPerM) / 1_000_000;

    const guard = await this.guardrail.check({
      userId: args.userId,
      plan: args.plan,
      estimatedCostUsd,
    });
    if (!guard.allowed) throw new Error(guard.message);

    const started = Date.now();
    const text = await this.llm.complete(args.prompt, {
      system: args.system,
      maxTokens: args.maxTokens,
    });

    const outputTokens = Math.ceil(text.length / 3);
    const costUsd = (inputTokens * pm.inputPerM + outputTokens * pm.outputPerM) / 1_000_000;
    await this.guardrail.record({
      userId: args.userId,
      plan: args.plan,
      actualCostUsd: costUsd,
      model: pm.model,
      provider: pm.provider,
      feature: args.feature,
      tokensIn: inputTokens,
      tokensOut: outputTokens,
      latencyMs: Date.now() - started,
    });

    return text;
  }

  private pickModelForCost(): {
    provider: string;
    model: string;
    inputPerM: number;
    outputPerM: number;
  } {
    const forced = process.env.LLM_PROVIDER;
    const provider =
      forced && ['anthropic', 'openrouter', 'groq', 'google'].includes(forced)
        ? forced
        : process.env.ANTHROPIC_API_KEY
          ? 'anthropic'
          : process.env.GROQ_API_KEY
            ? 'groq'
            : process.env.GOOGLE_GENERATIVE_AI_API_KEY
              ? 'google'
              : 'openrouter';

    switch (provider) {
      case 'anthropic':
        return { provider, model: 'claude-sonnet-4-6', inputPerM: 3, outputPerM: 15 };
      case 'groq':
        return { provider, model: 'llama-3.3-70b-versatile', inputPerM: 0, outputPerM: 0 };
      case 'google':
        return { provider, model: 'gemini-2.5-flash', inputPerM: 0, outputPerM: 0 };
      default:
        return {
          provider: 'openrouter',
          model: 'openai/gpt-oss-20b:free',
          inputPerM: 0,
          outputPerM: 0,
        };
    }
  }
}
