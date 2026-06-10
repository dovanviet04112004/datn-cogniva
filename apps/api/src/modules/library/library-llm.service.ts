/**
 * LibraryLlmService — guarded LLM call dùng chung toàn domain library
 * (reverse-search/goal-planner + atom extract/ingest summary/translate/
 * podcast). Port semantics routedGenerateText của web: cost guardrail check
 * TRƯỚC / record SAU — pattern ExamAiService.guardedComplete.
 *
 * 2 mặt API: `complete()` trả {text, costUsd, modelId} cho route cần echo
 * cost về client (atoms POST, podcast — y routedGenerateText cũ);
 * `guardedComplete()` là wrapper chỉ cần text.
 */
import { Injectable } from '@nestjs/common';

import { CostGuardrailService, type Plan } from '../../infra/ai/cost-guardrail.service';
import { LlmService } from '../../infra/ai/llm.service';

export type { Plan };

export interface GuardedLlmArgs {
  userId: string;
  plan: Plan;
  system: string;
  prompt: string;
  maxTokens: number;
  feature: string;
}

export interface GuardedLlmResult {
  text: string;
  costUsd: number;
  modelId: string;
}

@Injectable()
export class LibraryLlmService {
  constructor(
    private readonly llm: LlmService,
    private readonly guardrail: CostGuardrailService,
  ) {}

  /** Throw Error(guard.message) khi bị chặn — caller catch như CostGuardrailError cũ. */
  async complete(args: GuardedLlmArgs): Promise<GuardedLlmResult> {
    const pm = this.pickModelForCost();
    // Heuristic estimateInputTokens cũ: 1 token ≈ 3 chars (an toàn cho tiếng Việt).
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

    // LlmService không expose usage → xấp xỉ output bằng độ dài text.
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

    return { text, costUsd, modelId: pm.model };
  }

  /** Wrapper cho caller chỉ cần text (reverse-search, goal-planner). */
  async guardedComplete(args: GuardedLlmArgs): Promise<string> {
    return (await this.complete(args)).text;
  }

  /**
   * Model + giá ($/1M tokens) ứng với provider LlmService sẽ pick.
   * NGUỒN CHUẨN pick order ở src/infra/ai/llm.service.ts — đổi thì sửa cả 2.
   * Giá free-tier (groq/google/openrouter) = 0 như bảng PROVIDERS router cũ.
   */
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
        return { provider: 'openrouter', model: 'openai/gpt-oss-20b:free', inputPerM: 0, outputPerM: 0 };
    }
  }
}
