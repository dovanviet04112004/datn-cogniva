import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { CrossDocSearchService, type CrossDocChunkHit } from './cross-doc-search.service';
import { LibraryLlmService, type Plan } from '../shared/llm.service';

export type ReverseSearchInput = {
  problemText?: string;
  problemImageBase64?: string;
  problemImageMimeType?: string;
  hint?: {
    subjectSlug?: string;
    level?: string;
    grade?: number;
  };
  userId: string;
  plan: Plan;
};

export type ReverseSearchResult = {
  detectedQuestion: string;
  analysis: {
    subjectSlug: string;
    level: string;
    topic: string;
    atomKeywords: string[];
    difficulty: 'easy' | 'medium' | 'hard';
  };
  theory: CrossDocChunkHit[];
  exercise: CrossDocChunkHit[];
  exam: CrossDocChunkHit[];
};

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

@Injectable()
export class ReverseSearchService {
  constructor(
    private readonly crossDoc: CrossDocSearchService,
    private readonly libraryLlm: LibraryLlmService,
  ) {}

  async reverseSearch(input: ReverseSearchInput): Promise<ReverseSearchResult> {
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

    const analysis = await this.analyzeQuestion(questionText, input.hint, input.userId, input.plan);

    const searchQuery = [analysis.topic, ...analysis.atomKeywords, questionText.slice(0, 200)].join(
      ' ',
    );
    const baseFilter = {
      subjectSlug: analysis.subjectSlug,
      level: analysis.level,
      grade: input.hint?.grade ? [input.hint.grade] : undefined,
    };

    const [theoryResults, exerciseResults, examResults] = await Promise.all([
      this.crossDoc.crossDocSearch({
        query: searchQuery,
        filters: { ...baseFilter, docType: ['lecture_notes', 'summary', 'reference_book'] },
        limit: 3,
      }),
      this.crossDoc.crossDocSearch({
        query: searchQuery,
        filters: { ...baseFilter, docType: ['exercise', 'solution'] },
        limit: 5,
      }),
      this.crossDoc.crossDocSearch({
        query: searchQuery,
        filters: { ...baseFilter, docType: ['exam'] },
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

  private async analyzeQuestion(
    questionText: string,
    hint: ReverseSearchInput['hint'],
    userId: string,
    plan: Plan,
  ): Promise<ReverseSearchResult['analysis']> {
    const hintStr = hint
      ? `\nGợi ý: subject=${hint.subjectSlug ?? '?'}, level=${hint.level ?? '?'}, grade=${hint.grade ?? '?'}`
      : '';
    const userPrompt = `Câu hỏi:\n${questionText.slice(0, 1500)}${hintStr}\n\nTrả JSON analysis.`;

    try {
      const text = await this.libraryLlm.guardedComplete({
        userId,
        plan,
        system: ANALYSIS_SYSTEM,
        prompt: userPrompt,
        maxTokens: 250,
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
      return {
        subjectSlug: hint?.subjectSlug ?? 'math',
        level: hint?.level ?? 'HIGH_SCHOOL',
        topic: 'chưa xác định',
        atomKeywords: [],
        difficulty: 'medium',
      };
    }
  }
}

async function ocrImage(base64: string, mimeType: string): Promise<string> {
  const dataUrl = `data:${mimeType};base64,${base64}`;
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY missing');
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
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
      }),
    });
    if (!res.ok) throw new Error(`openai ${res.status}`);
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return json.choices?.[0]?.message?.content?.trim() ?? '';
  } catch (err) {
    console.error('[reverseSearch.ocr]', err);
    return '';
  }
}
