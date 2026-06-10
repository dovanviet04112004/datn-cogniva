/**
 * reverse-search — V1 Pillar #4 (2026-05-22).
 *
 * User upload đề khó (PDF/image/text) → AI parse câu hỏi → tìm trong library:
 *   1. Doc chứa lý thuyết liên quan (lecture_notes/summary type)
 *   2. Doc có bài tập tương tự (exercise type)
 *   3. Doc đề thi cùng dạng (exam type)
 *
 * Pipeline:
 *   1. OCR text từ input (image qua GPT-4o vision, PDF qua pdfjs, text raw)
 *   2. LLM phân tích → trích atom + subject + difficulty
 *   3. Search library_doc_chunk + library_doc_atom theo embedding
 *   4. Group results theo doc_type
 *
 * Spec: docs/plans/library-share.md §Reverse Search Pillar #4.
 */
import OpenAI from 'openai';
import { z } from 'zod';

import { routedGenerateText } from '@/lib/ai/router';

import { crossDocSearch, type CrossDocChunkHit } from './cross-doc-search';

let _openai: OpenAI | null = null;
function openaiClient(): OpenAI {
  if (_openai) return _openai;
  _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
  return _openai;
}

export type ReverseSearchInput = {
  /** Hoặc text đề (đã OCR), hoặc image URL/base64 — backend OCR. */
  problemText?: string;
  problemImageBase64?: string;
  problemImageMimeType?: string;
  /** User hint nếu có (subject, level) — giúp narrow scope. */
  hint?: {
    subjectSlug?: string;
    level?: string;
    grade?: number;
  };
  /** Cho cost guardrail. */
  userId: string;
  plan: 'FREE' | 'PRO' | 'TEAM' | 'ENTERPRISE';
};

export type ReverseSearchResult = {
  /** Câu hỏi đã extract (text plain). */
  detectedQuestion: string;
  /** AI phân tích topic + difficulty. */
  analysis: {
    subjectSlug: string;
    level: string;
    topic: string;
    atomKeywords: string[];
    difficulty: 'easy' | 'medium' | 'hard';
  };
  /** Doc lý thuyết liên quan (top 3). */
  theory: CrossDocChunkHit[];
  /** Doc bài tập tương tự (top 5). */
  exercise: CrossDocChunkHit[];
  /** Doc đề thi cùng dạng (top 3). */
  exam: CrossDocChunkHit[];
};

/**
 * Reverse search end-to-end.
 *
 * Flow:
 *   1. Lấy text từ input (text trực tiếp / OCR image qua GPT-4o vision)
 *   2. LLM phân tích question → subject/atoms/difficulty (use routedGenerateText)
 *   3. Search library_doc_chunk filter theo subject + doc_type=theory/exercise/exam
 *   4. Group + return
 */
export async function reverseSearch(
  input: ReverseSearchInput,
): Promise<ReverseSearchResult> {
  // ── Step 1: OCR / extract text ─────────────────────────────────────
  let questionText = input.problemText?.trim() ?? '';
  if (!questionText && input.problemImageBase64) {
    questionText = await ocrImage(
      input.problemImageBase64,
      input.problemImageMimeType ?? 'image/png',
    );
  }
  if (!questionText) {
    throw new Error('Không trích xuất được câu hỏi từ input');
  }

  // ── Step 2: AI analyze question ────────────────────────────────────
  const analysis = await analyzeQuestion(
    questionText,
    input.hint,
    input.userId,
    input.plan,
  );

  // ── Step 3: Search 3 categories parallel ──────────────────────────
  const searchQuery = [analysis.topic, ...analysis.atomKeywords, questionText.slice(0, 200)].join(' ');
  const baseFilter = {
    subjectSlug: analysis.subjectSlug,
    level: analysis.level,
    grade: input.hint?.grade ? [input.hint.grade] : undefined,
  };

  const [theoryResults, exerciseResults, examResults] = await Promise.all([
    crossDocSearch({
      query: searchQuery,
      filters: {
        ...baseFilter,
        docType: ['lecture_notes', 'summary', 'reference_book'],
      },
      limit: 3,
    }),
    crossDocSearch({
      query: searchQuery,
      filters: {
        ...baseFilter,
        docType: ['exercise', 'solution'],
      },
      limit: 5,
    }),
    crossDocSearch({
      query: searchQuery,
      filters: {
        ...baseFilter,
        docType: ['exam'],
      },
      limit: 3,
    }),
  ]);

  return {
    detectedQuestion: questionText,
    analysis,
    theory: theoryResults,
    exercise: exerciseResults,
    exam: examResults,
  };
}

// ─── OCR via GPT-4o vision ───────────────────────────────────────────
async function ocrImage(base64: string, mimeType: string): Promise<string> {
  const dataUrl = `data:${mimeType};base64,${base64}`;
  try {
    const res = await openaiClient().chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Trích xuất CHÍNH XÁC câu hỏi (đề bài) trong ảnh. Chỉ trả về text câu hỏi, KHÔNG thêm chú thích. Giữ nguyên ký hiệu toán học và format số.',
            },
            { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
          ],
        },
      ],
      max_tokens: 1000,
    });
    return res.choices[0]?.message?.content?.trim() ?? '';
  } catch (err) {
    console.error('[reverseSearch.ocr]', err);
    return '';
  }
}

// ─── AI question analysis ────────────────────────────────────────────
const ANALYSIS_SCHEMA = z.object({
  subjectSlug: z.string(),
  level: z.string(),
  topic: z.string(),
  atomKeywords: z.array(z.string()).max(5),
  difficulty: z.enum(['easy', 'medium', 'hard']),
});

const ANALYSIS_SYSTEM = `Bạn phân tích câu hỏi học thuật tiếng Việt → JSON.

Output BẮT BUỘC JSON:
{
  "subjectSlug": "math|physics|chemistry|literature|english|english-ielts|english-toeic|cs-programming|japanese|...",
  "level": "PRIMARY|SECONDARY|HIGH_SCHOOL|UNIVERSITY|ADULT",
  "topic": "chủ đề ngắn < 30 ký tự (vd 'tích phân từng phần', 'phản ứng oxi hoá khử')",
  "atomKeywords": ["concept con 1", "concept con 2"] (≤ 5 keywords, mỗi cái 1-3 từ),
  "difficulty": "easy|medium|hard"
}

CHỈ trả JSON, không markdown, không text thừa.`;

async function analyzeQuestion(
  questionText: string,
  hint: ReverseSearchInput['hint'],
  userId: string,
  plan: ReverseSearchInput['plan'],
): Promise<ReverseSearchResult['analysis']> {
  const hintStr = hint
    ? `\nGợi ý: subject=${hint.subjectSlug ?? '?'}, level=${hint.level ?? '?'}, grade=${hint.grade ?? '?'}`
    : '';
  const userPrompt = `Câu hỏi:\n${questionText.slice(0, 1500)}${hintStr}\n\nTrả JSON analysis.`;

  try {
    const { text } = await routedGenerateText({
      useCase: 'classify',
      userId,
      plan,
      system: ANALYSIS_SYSTEM,
      messages: [{ role: 'user', content: userPrompt }],
      maxOutputTokens: 250,
      feature: 'library.reverse-search.analyze',
    });
    const cleaned = text
      .trim()
      .replace(/^```(?:json)?\s*/, '')
      .replace(/\s*```$/, '');
    const parsed = ANALYSIS_SCHEMA.parse(JSON.parse(cleaned));
    return parsed;
  } catch (err) {
    console.error('[reverseSearch.analyze]', err);
    // Fallback — best-effort từ hint
    return {
      subjectSlug: hint?.subjectSlug ?? 'math',
      level: hint?.level ?? 'HIGH_SCHOOL',
      topic: 'chưa xác định',
      atomKeywords: [],
      difficulty: 'medium',
    };
  }
}
