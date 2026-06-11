import { Injectable } from '@nestjs/common';

import { CostGuardrailService, type Plan } from '../../../infra/ai/cost-guardrail.service';
import { LlmService } from '../../../infra/ai/llm.service';

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

  async complete(args: GuardedLlmArgs): Promise<GuardedLlmResult> {
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

    return { text, costUsd, modelId: pm.model };
  }

  async guardedComplete(args: GuardedLlmArgs): Promise<string> {
    return (await this.complete(args)).text;
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
