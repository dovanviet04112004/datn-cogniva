/**
 * FlashcardGenService — LLM scan chunk → sinh cặp Q-A / câu cloze cho ôn thi.
 * Port từ apps/web/src/lib/flashcards/generate.ts, prompt giữ NGUYÊN VĂN.
 *
 * Khác bản web (routedGenerateText):
 *   - Không có fallback-chain/circuit-breaker/semantic-cache — mỗi call đi
 *     thẳng LlmService (Wave 7 nối lại router DI đầy đủ); output shape không đổi.
 *   - Cost guardrail vẫn check trước / record sau mỗi call như router cũ.
 *
 * IMAGE_OCCLUSION không có generator AI (cần ảnh + user vẽ mask thủ công).
 * Failure: LLM trả invalid JSON / empty / guardrail deny → [] (skip chunk).
 */
import { Injectable } from '@nestjs/common';

import { CostGuardrailService, type Plan } from '../../infra/ai/cost-guardrail.service';
import { LlmService } from '../../infra/ai/llm.service';

/** Context bắt buộc — route cũ luôn truyền để đi router (guardrail). */
export interface GenerateContext {
  userId: string;
  plan: Plan;
}

const BASIC_INSTRUCTION = `Bạn là chuyên gia tạo flashcard ôn thi. Đọc đoạn văn và tạo 1-3 thẻ flashcard ngắn gọn để học sinh ôn lại NỘI DUNG CỐT LÕI.

QUY TẮC:
- Mỗi thẻ có "front" (câu hỏi/khái niệm) và "back" (câu trả lời ngắn 1-2 câu).
- Tập trung vào định nghĩa, fact, công thức, mối quan hệ — không hỏi vu vơ.
- Tránh tạo thẻ trùng ý nhau.
- Trả lời cùng ngôn ngữ với đoạn văn.

ĐỊNH DẠNG OUTPUT — JSON THUẦN, KHÔNG markdown, KHÔNG backtick:
{"cards": [{"front": "...", "back": "..."}]}

ĐOẠN VĂN:
"""
{{CONTENT}}
"""`;

const CLOZE_INSTRUCTION = `Bạn là chuyên gia tạo flashcard cloze. Đọc đoạn văn và sinh 1-3 câu CLOZE để học sinh điền vào chỗ trống.

QUY TẮC:
- Mỗi câu cloze chọn 1 KEYWORD quan trọng (tên, năm, thuật ngữ, công thức) bọc bằng \`{{c1::keyword}}\`.
- Câu phải đủ ngữ cảnh để đoán được từ thiếu (ko quá ngắn).
- Tránh che từ chung chung "is", "the", "of".
- Trả lời cùng ngôn ngữ với đoạn văn.

ĐỊNH DẠNG OUTPUT — JSON THUẦN:
{"cards": [{"text": "Câu có {{c1::keyword}} ở giữa"}]}

ĐOẠN VĂN:
"""
{{CONTENT}}
"""`;

// System = phần trước {{CONTENT}} (derive y hệt route cũ split + trim);
// content đẩy xuống user message — giữ cấu trúc router cũ cho Wave 7 nối cache.
const BASIC_SYSTEM = BASIC_INSTRUCTION.split('{{CONTENT}}')[0]!.trim();
const CLOZE_SYSTEM = CLOZE_INSTRUCTION.split('{{CONTENT}}')[0]!.trim();

export type GeneratedCard =
  | { type: 'BASIC'; front: string; back: string }
  | { type: 'CLOZE'; text: string };

/** Strip code fence + extract object JSON đầu tiên. */
function extractJson(text: string): unknown {
  const stripped = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const match = stripped.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON object in LLM output');
  return JSON.parse(match[0]);
}

@Injectable()
export class FlashcardGenService {
  constructor(
    private readonly llm: LlmService,
    private readonly guardrail: CostGuardrailService,
  ) {}

  /** Generate cards BASIC từ 1 chunk content. Lỗi bất kỳ → [] (skip chunk). */
  async generateBasicCards(content: string, ctx: GenerateContext): Promise<GeneratedCard[]> {
    if (content.length < 50) return [];
    try {
      const text = await this.completeGuarded(content, ctx, BASIC_SYSTEM, 'flashcard-basic-gen');
      const obj = extractJson(text) as { cards?: unknown };
      if (!Array.isArray(obj.cards)) return [];
      return obj.cards
        .filter(
          (c): c is { front: string; back: string } =>
            typeof (c as { front?: unknown }).front === 'string' &&
            typeof (c as { back?: unknown }).back === 'string',
        )
        .map((c) => ({
          type: 'BASIC' as const,
          front: c.front.trim(),
          back: c.back.trim(),
        }));
    } catch (err) {
      console.warn('[generate-basic] skip:', (err as Error).message);
      return [];
    }
  }

  /** Generate cards CLOZE từ 1 chunk content. Lỗi bất kỳ → [] (skip chunk). */
  async generateClozeCards(content: string, ctx: GenerateContext): Promise<GeneratedCard[]> {
    if (content.length < 50) return [];
    try {
      const text = await this.completeGuarded(content, ctx, CLOZE_SYSTEM, 'flashcard-cloze-gen');
      const obj = extractJson(text) as { cards?: unknown };
      if (!Array.isArray(obj.cards)) return [];
      return obj.cards
        .filter((c): c is { text: string } => typeof (c as { text?: unknown }).text === 'string')
        .map((c) => ({ type: 'CLOZE' as const, text: c.text.trim() }))
        .filter((c) => /\{\{c\d+::/.test(c.text)); // chỉ giữ nếu có cloze marker
    } catch (err) {
      console.warn('[generate-cloze] skip:', (err as Error).message);
      return [];
    }
  }

  /** Guardrail check → LLM → record, như routedGenerateText cũ. Throw khi deny/fail. */
  private async completeGuarded(
    content: string,
    ctx: GenerateContext,
    system: string,
    feature: string,
  ): Promise<string> {
    // Estimate 0 vì provider khả dụng thực tế là free tier (Groq/Gemini —
    // pricing 0 như chain free của router cũ) — vẫn chặn được DAILY_QUOTA
    // đã cạn + GLOBAL_CIRCUIT.
    const guard = await this.guardrail.check({
      userId: ctx.userId,
      plan: ctx.plan,
      estimatedCostUsd: 0,
    });
    if (!guard.allowed) throw new Error(guard.message);

    const text = await this.llm.complete(`ĐOẠN VĂN:\n"""\n${content}\n"""`, {
      system,
      maxTokens: 600, // khớp maxOutputTokens router cũ (1-3 thẻ/chunk)
    });

    // Seam cho Wave 7: free tier → cost 0, record() tự no-op như recordCost web.
    await this.guardrail.record({
      userId: ctx.userId,
      plan: ctx.plan,
      actualCostUsd: 0,
      model: 'llm-default',
      feature,
    });

    return text;
  }
}
