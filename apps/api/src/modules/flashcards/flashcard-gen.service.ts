import { Injectable } from '@nestjs/common';

import { CostGuardrailService, type Plan } from '../../infra/ai/cost-guardrail.service';
import { LlmService } from '../../infra/ai/llm.service';

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

const BASIC_SYSTEM = BASIC_INSTRUCTION.split('{{CONTENT}}')[0]!.trim();
const CLOZE_SYSTEM = CLOZE_INSTRUCTION.split('{{CONTENT}}')[0]!.trim();

export type GeneratedCard =
  | { type: 'BASIC'; front: string; back: string }
  | { type: 'CLOZE'; text: string };

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

  async generateClozeCards(content: string, ctx: GenerateContext): Promise<GeneratedCard[]> {
    if (content.length < 50) return [];
    try {
      const text = await this.completeGuarded(content, ctx, CLOZE_SYSTEM, 'flashcard-cloze-gen');
      const obj = extractJson(text) as { cards?: unknown };
      if (!Array.isArray(obj.cards)) return [];
      return obj.cards
        .filter((c): c is { text: string } => typeof (c as { text?: unknown }).text === 'string')
        .map((c) => ({ type: 'CLOZE' as const, text: c.text.trim() }))
        .filter((c) => /\{\{c\d+::/.test(c.text));
    } catch (err) {
      console.warn('[generate-cloze] skip:', (err as Error).message);
      return [];
    }
  }

  private async completeGuarded(
    content: string,
    ctx: GenerateContext,
    system: string,
    feature: string,
  ): Promise<string> {
    const guard = await this.guardrail.check({
      userId: ctx.userId,
      plan: ctx.plan,
      estimatedCostUsd: 0,
    });
    if (!guard.allowed) throw new Error(guard.message);

    const text = await this.llm.complete(`ĐOẠN VĂN:\n"""\n${content}\n"""`, {
      system,
      maxTokens: 600,
    });

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
