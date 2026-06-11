/**
 * RouterService — port apps/web/src/lib/ai/router.ts (+ models pricing từ
 * lib/observability/cost.ts + prompt-cache helpers từ lib/ai/prompt-cache.ts).
 *
 * LLM router đa provider với fallback chain:
 *   1. Route theo use case (ROUTES map — copy nguyên bảng model của web).
 *   2. Mỗi provider call wrap CircuitBreakerService `llm:{provider}:{model}`
 *      (key Redis cb:* dùng chung admin dashboard) — CircuitOpenError HOẶC lỗi
 *      bất kỳ → thử fallback kế; hết chain → AllProvidersFailedError.
 *   3. Cost guardrail pre-check (CostGuardrailService 3 lớp) → CostGuardrailError.
 *   4. Semantic cache opt-in (exact-hash Redis) lookup TRƯỚC guardrail vì hit = free.
 *   5. Record actual cost sau onFinish (Redis counters + ai_usage_log).
 *
 * Provider qua AI SDK v4 (cùng package + version với web): @ai-sdk/anthropic,
 * @ai-sdk/openai (createOpenAI cho OpenRouter), @ai-sdk/groq, @ai-sdk/google.
 * isAvailable() check env key CÓ GIÁ TRỊ — thực tế ANTHROPIC_API_KEY rỗng →
 * ragChat chạy Groq Llama 3.3 70B free làm primary thực tế.
 */
import { Injectable } from '@nestjs/common';
import {
  streamText,
  generateText,
  type LanguageModel,
  type CoreMessage,
} from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createGroq } from '@ai-sdk/groq';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { logger } from '@cogniva/server-core';

import { CircuitBreakerService, CircuitOpenError } from './circuit-breaker.service';
import { CostGuardrailService, type Plan } from './cost-guardrail.service';
import {
  SemanticCacheService,
  streamCachedText,
  type CachedResponse,
  type CacheScope,
} from './semantic-cache.service';

type StreamTextResult = ReturnType<typeof streamText>;

// ────────────────────────────────────────────────────────────
// Provider configs (copy nguyên bảng web)
// ────────────────────────────────────────────────────────────

type ProviderId = 'anthropic' | 'openrouter' | 'openai' | 'groq' | 'google';
type ModelId = string;

type ProviderModel = {
  provider: ProviderId;
  model: ModelId;
  /** USD per 1M input tokens. */
  inputPerM: number;
  /** USD per 1M output tokens. */
  outputPerM: number;
  /** Available env check — provider chỉ usable nếu env có GIÁ TRỊ. */
  isAvailable: () => boolean;
};

const PROVIDERS: Record<string, ProviderModel> = {
  'anthropic:sonnet-4-6': {
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    inputPerM: 3,
    outputPerM: 15,
    isAvailable: () => !!process.env.ANTHROPIC_API_KEY,
  },
  'anthropic:haiku-4-5': {
    provider: 'anthropic',
    model: 'claude-haiku-4-5',
    inputPerM: 0.8,
    outputPerM: 4,
    isAvailable: () => !!process.env.ANTHROPIC_API_KEY,
  },
  'anthropic:opus-4-7': {
    provider: 'anthropic',
    model: 'claude-opus-4-7',
    inputPerM: 15,
    outputPerM: 75,
    isAvailable: () => !!process.env.ANTHROPIC_API_KEY,
  },
  'openrouter:gpt-oss-20b': {
    provider: 'openrouter',
    model: 'openai/gpt-oss-20b:free',
    inputPerM: 0,
    outputPerM: 0,
    isAvailable: () => !!process.env.OPENROUTER_API_KEY,
  },
  'openrouter:glm-4.5-air': {
    provider: 'openrouter',
    model: 'z-ai/glm-4.5-air:free',
    inputPerM: 0,
    outputPerM: 0,
    isAvailable: () => !!process.env.OPENROUTER_API_KEY,
  },
  // ── Groq (free 30 req/min, ~800 tok/s) — free tier inputPerM=0 ──
  'groq:llama-3.3-70b': {
    provider: 'groq',
    model: 'llama-3.3-70b-versatile',
    inputPerM: 0,
    outputPerM: 0,
    isAvailable: () => !!process.env.GROQ_API_KEY,
  },
  'groq:llama-3.1-8b': {
    provider: 'groq',
    model: 'llama-3.1-8b-instant',
    inputPerM: 0,
    outputPerM: 0,
    isAvailable: () => !!process.env.GROQ_API_KEY,
  },
  // ── Gemini (free 15 req/min, 1M token/day) ──
  'google:gemini-2.5-flash': {
    provider: 'google',
    model: 'gemini-2.5-flash',
    inputPerM: 0,
    outputPerM: 0,
    isAvailable: () => !!process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  },
  'google:gemini-2.0-flash-lite': {
    provider: 'google',
    model: 'gemini-2.0-flash-lite',
    inputPerM: 0,
    outputPerM: 0,
    isAvailable: () => !!process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  },
};

// ────────────────────────────────────────────────────────────
// Use case → route mapping
// ────────────────────────────────────────────────────────────

export type UseCase =
  | 'ragChat' // user-facing RAG chat
  | 'reasoning' // hard math / multi-step
  | 'classify' // chunking metadata, intent classify
  | 'roomTutor' // in-room AI streaming
  | 'flashcardGen' // generate flashcards
  | 'quizGen' // generate quiz
  | 'noteComplete' // autocomplete in note editor
  | 'summarize'; // recording summary

type Route = {
  primary: keyof typeof PROVIDERS;
  fallback: Array<keyof typeof PROVIDERS>;
  /** Max output tokens cho route — guard against runaway. */
  maxOutputTokens: number;
};

const ROUTES: Record<UseCase, Route> = {
  ragChat: {
    primary: 'anthropic:sonnet-4-6',
    fallback: ['groq:llama-3.3-70b', 'google:gemini-2.5-flash', 'openrouter:gpt-oss-20b'],
    maxOutputTokens: 1500,
  },
  reasoning: {
    primary: 'anthropic:opus-4-7',
    fallback: ['anthropic:sonnet-4-6', 'groq:llama-3.3-70b', 'google:gemini-2.5-flash'],
    maxOutputTokens: 4000,
  },
  classify: {
    primary: 'anthropic:haiku-4-5',
    fallback: ['groq:llama-3.1-8b', 'google:gemini-2.0-flash-lite', 'openrouter:gpt-oss-20b'],
    maxOutputTokens: 500,
  },
  roomTutor: {
    primary: 'anthropic:sonnet-4-6',
    fallback: ['anthropic:haiku-4-5', 'groq:llama-3.3-70b', 'openrouter:gpt-oss-20b'],
    maxOutputTokens: 800,
  },
  flashcardGen: {
    primary: 'anthropic:sonnet-4-6',
    fallback: ['anthropic:haiku-4-5', 'groq:llama-3.3-70b', 'google:gemini-2.5-flash'],
    maxOutputTokens: 2000,
  },
  quizGen: {
    primary: 'anthropic:sonnet-4-6',
    fallback: ['anthropic:haiku-4-5', 'groq:llama-3.3-70b', 'google:gemini-2.5-flash'],
    maxOutputTokens: 3000,
  },
  noteComplete: {
    primary: 'anthropic:haiku-4-5',
    fallback: ['groq:llama-3.1-8b', 'google:gemini-2.0-flash-lite', 'openrouter:gpt-oss-20b'],
    maxOutputTokens: 300,
  },
  summarize: {
    primary: 'anthropic:sonnet-4-6',
    fallback: ['anthropic:haiku-4-5', 'groq:llama-3.3-70b', 'google:gemini-2.5-flash'],
    maxOutputTokens: 1000,
  },
};

// ────────────────────────────────────────────────────────────
// Client construction (lazy singleton như web)
// ────────────────────────────────────────────────────────────

let _openrouter: ReturnType<typeof createOpenAI> | undefined;
function getOpenRouterFactory() {
  if (_openrouter) return _openrouter;
  _openrouter = createOpenAI({
    apiKey: process.env.OPENROUTER_API_KEY!,
    baseURL: 'https://openrouter.ai/api/v1',
    headers: {
      'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
      'X-Title': 'Cogniva',
    },
    compatibility: 'compatible',
  });
  return _openrouter;
}

let _groq: ReturnType<typeof createGroq> | undefined;
function getGroqFactory() {
  if (_groq) return _groq;
  _groq = createGroq({ apiKey: process.env.GROQ_API_KEY! });
  return _groq;
}

let _google: ReturnType<typeof createGoogleGenerativeAI> | undefined;
function getGoogleFactory() {
  if (_google) return _google;
  _google = createGoogleGenerativeAI({
    apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY!,
  });
  return _google;
}

/** Resolve LanguageModel cho provider:model. Throw nếu provider thiếu env. */
function getModel(pm: ProviderModel): LanguageModel {
  switch (pm.provider) {
    case 'anthropic':
      return anthropic(pm.model);
    case 'openrouter':
      return getOpenRouterFactory()(pm.model);
    case 'groq':
      return getGroqFactory()(pm.model);
    case 'google':
      return getGoogleFactory()(pm.model);
    case 'openai':
      throw new Error('OpenAI direct provider chưa implement');
    default:
      throw new Error(`Unknown provider: ${pm.provider}`);
  }
}

/** Chain provider khả dụng cho use case — filter provider thiếu env key. */
function getProviderChain(useCase: UseCase): ProviderModel[] {
  const route = ROUTES[useCase];
  const chain = [route.primary, ...route.fallback];
  return chain.map((id) => PROVIDERS[id]!).filter((p) => p.isAvailable());
}

// ────────────────────────────────────────────────────────────
// Pricing — port từ lib/observability/cost.ts calcCostUsd
// ────────────────────────────────────────────────────────────

const MODEL_PRICING: Record<string, { inputPerM: number; outputPerM: number }> = {
  'claude-sonnet-4-6': { inputPerM: 3, outputPerM: 15 },
  'claude-sonnet-4-5': { inputPerM: 3, outputPerM: 15 },
  'claude-haiku-4-5': { inputPerM: 0.25, outputPerM: 1.25 },
  'claude-opus-4-7': { inputPerM: 15, outputPerM: 75 },
  'gemini-2.0-flash': { inputPerM: 0.075, outputPerM: 0.3 },
  'voyage-3': { inputPerM: 0.18, outputPerM: 0 },
  'voyage-3-large': { inputPerM: 0.18, outputPerM: 0 },
};

/** Tính cost USD từ model + token. Unknown model → 0 (free tier, không charge thừa). */
function calcCostUsd(modelId: string, promptTokens: number, completionTokens: number): number {
  const pricing = MODEL_PRICING[modelId];
  if (!pricing) return 0;
  const cost =
    (promptTokens * pricing.inputPerM + completionTokens * pricing.outputPerM) / 1_000_000;
  return Number(cost.toFixed(6));
}

/**
 * Estimate cost từ input tokens + max output cap — port từ web
 * cost-guardrail.estimateCostUsd. Conservative: dùng output cap thay vì
 * expected output (chống underestimate).
 */
function estimateCostUsd(args: {
  inputTokens: number;
  maxOutputTokens: number;
  inputPerMUsd: number;
  outputPerMUsd: number;
}): number {
  return (
    (args.inputTokens * args.inputPerMUsd + args.maxOutputTokens * args.outputPerMUsd) /
    1_000_000
  );
}

// ────────────────────────────────────────────────────────────
// Anthropic prompt cache helpers — port từ lib/ai/prompt-cache.ts
// (chỉ router dùng nên inline ở đây thay vì file riêng)
// ────────────────────────────────────────────────────────────

/** Min char để cân nhắc cache (~1024 token với 3 char/token VN). */
const MIN_CACHE_CHARS = 3_500;

function estimateTokensFromChars(text: string): number {
  return Math.ceil(text.length / 3);
}

/** Chỉ Anthropic + system đủ dài (Anthropic reject cache < 1024 token). */
function shouldEnableCache(provider: string, systemLength: number): boolean {
  if (provider !== 'anthropic') return false;
  if (systemLength < MIN_CACHE_CHARS) return false;
  return true;
}

/** System message với cacheControl ephemeral — null nếu system quá ngắn. */
function buildCachedMessages(system: string, messages: CoreMessage[]): CoreMessage[] | null {
  if (estimateTokensFromChars(system) < 1024) {
    return null;
  }
  const systemMessage: CoreMessage = {
    role: 'system',
    content: system,
    providerOptions: {
      anthropic: {
        cacheControl: { type: 'ephemeral' },
      },
    },
  };
  return [systemMessage, ...messages];
}

type PromptCacheStats = {
  cacheCreationTokens: number;
  cacheReadTokens: number;
  /** True nếu có cache read (= cache hit ở previous request). */
  cacheHit: boolean;
};

function extractCacheStats(providerMetadata: unknown): PromptCacheStats {
  const anthropicMeta = (providerMetadata as Record<string, unknown> | undefined)?.anthropic as
    | { cacheCreationInputTokens?: number; cacheReadInputTokens?: number }
    | undefined;
  const cacheCreation = anthropicMeta?.cacheCreationInputTokens ?? 0;
  const cacheRead = anthropicMeta?.cacheReadInputTokens ?? 0;
  return {
    cacheCreationTokens: cacheCreation,
    cacheReadTokens: cacheRead,
    cacheHit: cacheRead > 0,
  };
}

// ────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────

export type RoutedStreamOptions = {
  useCase: UseCase;
  userId: string;
  plan: Plan;
  /** Estimate input tokens — caller có thể đếm trước hoặc dùng heuristic. */
  estimatedInputTokens?: number;
  system?: string;
  messages: CoreMessage[];
  /** Override maxOutputTokens từ route default. */
  maxOutputTokens?: number;
  /** Feature tag cho cost breakdown analytics. */
  feature?: string;
  /** Per-message timeout (ms). */
  timeoutMs?: number;
  /** Anthropic prompt caching — default true cho Anthropic provider. */
  enablePromptCache?: boolean;
  /**
   * Semantic cache (Redis exact-hash). Default false — caller opt-in.
   * KHÔNG bật cho conversational (mỗi msg depend prev).
   */
  enableSemanticCache?: boolean;
  /** Scope cache: 'user' (default, safe) hoặc 'shared' cho factual content. */
  cacheScope?: CacheScope;
  /** TTL cache (sec). Default 300. */
  cacheTtlSec?: number;
};

export type RoutedFinishInfo = {
  text: string;
  promptTokens: number;
  completionTokens: number;
  modelId: string;
  providerId: ProviderId;
  costUsd: number;
  /** True nếu Anthropic prompt cache hit (hoặc semantic cache hit). */
  cacheHit: boolean;
  /** Number of cached tokens read (for analytics). */
  cacheReadTokens: number;
};

export type RoutedStreamResult = {
  textStream: AsyncIterable<string>;
  /** Resolve khi stream xong. Trả meta info. */
  finishPromise: Promise<RoutedFinishInfo>;
  /** Provider thực sự được dùng (sau fallback). */
  providerUsed: ProviderId;
  modelUsed: ModelId;
  /**
   * Raw streamText result — caller dùng mergeIntoDataStream/pipeDataStream...
   * Với semantic-cache hit đây là STUB (chỉ có textStream) — caller phải kiểm
   * cacheHit trước khi dùng mergeIntoDataStream.
   */
  result: StreamTextResult;
};

export type RoutedGenerateResult = {
  text: string;
  promptTokens: number;
  completionTokens: number;
  modelId: string;
  providerId: ProviderId;
  costUsd: number;
};

// ────────────────────────────────────────────────────────────
// Errors (shape giữ y web — chat route map status theo instanceof)
// ────────────────────────────────────────────────────────────

export class CostGuardrailError extends Error {
  override name = 'CostGuardrailError';
  constructor(
    message: string,
    public reason: 'PER_REQUEST_CAP' | 'DAILY_QUOTA' | 'GLOBAL_CIRCUIT',
  ) {
    super(message);
  }
}

export class AllProvidersFailedError extends Error {
  override name = 'AllProvidersFailedError';
  constructor(
    message: string,
    public lastError?: Error,
  ) {
    super(message);
  }
}

/** Heuristic 3 ký tự/token (VN-safe) — chỉ để estimate cost, không cần chính xác. */
function estimateInputTokens(opts: RoutedStreamOptions): number {
  const systemLen = opts.system?.length ?? 0;
  const messagesLen = opts.messages.reduce((sum, m) => {
    if (typeof m.content === 'string') return sum + m.content.length;
    return sum + 100; // multimodal, estimate
  }, 0);
  return Math.ceil((systemLen + messagesLen) / 3);
}

@Injectable()
export class RouterService {
  constructor(
    private readonly circuitBreaker: CircuitBreakerService,
    private readonly guardrail: CostGuardrailService,
    private readonly semanticCache: SemanticCacheService,
  ) {}

  /**
   * Stream LLM response với fallback chain + guardrail tự động.
   * Flow: chain → semantic cache lookup (opt-in, TRƯỚC guardrail vì hit=free)
   * → guardrail → loop chain qua circuit breaker → executeStream.
   */
  async routedStreamText(opts: RoutedStreamOptions): Promise<RoutedStreamResult> {
    const chain = getProviderChain(opts.useCase);
    if (chain.length === 0) {
      throw new Error(
        `[ai-router] Không có provider khả dụng cho use case "${opts.useCase}". ` +
          'Set ANTHROPIC_API_KEY hoặc OPENROUTER_API_KEY trong .env.local.',
      );
    }

    const route = ROUTES[opts.useCase];
    const maxOut = opts.maxOutputTokens ?? route.maxOutputTokens;

    // Estimate cost với primary (worst case nếu fallback rẻ hơn)
    const primary = chain[0]!;
    const estimatedInput = opts.estimatedInputTokens ?? estimateInputTokens(opts);
    const estimatedCost = estimateCostUsd({
      inputTokens: estimatedInput,
      maxOutputTokens: maxOut,
      inputPerMUsd: primary.inputPerM,
      outputPerMUsd: primary.outputPerM,
    });

    // ── Semantic cache lookup (TRƯỚC guardrail vì hit = free) ─────────
    if (opts.enableSemanticCache && opts.system) {
      const lastUserMsg = [...opts.messages].reverse().find((m) => m.role === 'user');
      const queryText = typeof lastUserMsg?.content === 'string' ? lastUserMsg.content : '';
      if (queryText) {
        const cachedResp = await this.semanticCache.getCachedResponse({
          useCase: opts.useCase,
          query: queryText,
          systemPrompt: opts.system,
          scope: opts.cacheScope ?? 'user',
          userId: opts.userId,
        });
        await this.semanticCache.recordCacheStat(opts.useCase, !!cachedResp);
        if (cachedResp) {
          // Hit — stream cached text mimic streamText. KHÔNG record cost.
          return buildCachedResult(cachedResp);
        }
      }
    }

    // Cost guardrail — deny nếu vượt
    const guard = await this.guardrail.check({
      userId: opts.userId,
      plan: opts.plan,
      estimatedCostUsd: estimatedCost,
    });
    if (!guard.allowed) {
      logger.warn('ai-router.denied', {
        reason: guard.reason,
        user_id: opts.userId,
        use_case: opts.useCase,
        estimated_cost_usd: estimatedCost,
      });
      throw new CostGuardrailError(guard.message, guard.reason);
    }

    // Try chain — primary trước, fallback nếu circuit OPEN hoặc lỗi
    let lastError: Error | undefined;
    for (const pm of chain) {
      const circuitName = `llm:${pm.provider}:${pm.model}`;
      try {
        return await this.circuitBreaker.withCircuitBreaker(circuitName, async () => {
          const model = getModel(pm);
          return this.executeStream({ model, providerModel: pm, opts, maxOut });
        });
      } catch (err) {
        lastError = err as Error;
        if (err instanceof CircuitOpenError) {
          logger.warn('ai-router.circuit_open_skip', {
            circuit: circuitName,
            use_case: opts.useCase,
          });
          continue; // try next fallback
        }
        // Lỗi khác (rate limit provider, network, etc.) → cũng fallback
        logger.warn('ai-router.provider_failed', {
          circuit: circuitName,
          use_case: opts.useCase,
          error: err instanceof Error ? err.message : String(err),
        });
        continue;
      }
    }

    throw new AllProvidersFailedError(
      `Tất cả ${chain.length} provider thất bại cho ${opts.useCase}`,
      lastError,
    );
  }

  /** Non-streaming variant — cho task batch (classify, quick-gen, summarize). */
  async routedGenerateText(opts: RoutedStreamOptions): Promise<RoutedGenerateResult> {
    const chain = getProviderChain(opts.useCase);
    if (chain.length === 0) {
      throw new Error(`[ai-router] Không có provider cho ${opts.useCase}`);
    }
    const route = ROUTES[opts.useCase];
    const maxOut = opts.maxOutputTokens ?? route.maxOutputTokens;

    const primary = chain[0]!;
    const estimatedInput = opts.estimatedInputTokens ?? estimateInputTokens(opts);
    const estimatedCost = estimateCostUsd({
      inputTokens: estimatedInput,
      maxOutputTokens: maxOut,
      inputPerMUsd: primary.inputPerM,
      outputPerMUsd: primary.outputPerM,
    });

    // ── Semantic cache lookup — result trả full text 1 lần (không stream) ──
    if (opts.enableSemanticCache && opts.system) {
      const lastUserMsg = [...opts.messages].reverse().find((m) => m.role === 'user');
      const queryText = typeof lastUserMsg?.content === 'string' ? lastUserMsg.content : '';
      if (queryText) {
        const cachedResp = await this.semanticCache.getCachedResponse({
          useCase: opts.useCase,
          query: queryText,
          systemPrompt: opts.system,
          scope: opts.cacheScope ?? 'user',
          userId: opts.userId,
        });
        await this.semanticCache.recordCacheStat(opts.useCase, !!cachedResp);
        if (cachedResp) {
          return {
            text: cachedResp.text,
            promptTokens: cachedResp.promptTokens,
            completionTokens: cachedResp.completionTokens,
            modelId: cachedResp.modelId,
            providerId: cachedResp.providerId as ProviderId,
            costUsd: 0, // cache hit = free
          };
        }
      }
    }

    const guard = await this.guardrail.check({
      userId: opts.userId,
      plan: opts.plan,
      estimatedCostUsd: estimatedCost,
    });
    if (!guard.allowed) {
      throw new CostGuardrailError(guard.message, guard.reason);
    }

    let lastError: Error | undefined;
    for (const pm of chain) {
      const circuitName = `llm:${pm.provider}:${pm.model}`;
      try {
        return await this.circuitBreaker.withCircuitBreaker(circuitName, async () => {
          const model = getModel(pm);
          const result = await generateText({
            model,
            system: opts.system,
            messages: opts.messages,
            maxTokens: maxOut,
            abortSignal: opts.timeoutMs ? AbortSignal.timeout(opts.timeoutMs) : undefined,
          });

          const costUsd = calcCostUsd(
            pm.model,
            result.usage.promptTokens,
            result.usage.completionTokens,
          );
          await this.guardrail.record({
            userId: opts.userId,
            plan: opts.plan,
            actualCostUsd: costUsd,
            model: pm.model,
            feature: opts.feature ?? opts.useCase,
            provider: pm.provider,
            tokensIn: result.usage.promptTokens,
            tokensOut: result.usage.completionTokens,
          });
          logger.info('ai-router.completed', {
            use_case: opts.useCase,
            provider: pm.provider,
            model: pm.model,
            prompt_tokens: result.usage.promptTokens,
            completion_tokens: result.usage.completionTokens,
            cost_usd: costUsd,
            user_id: opts.userId,
          });

          // Save vào cache nếu opt-in. Best-effort, không block return.
          if (opts.enableSemanticCache && opts.system) {
            const lastUserMsg = [...opts.messages].reverse().find((m) => m.role === 'user');
            const queryText =
              typeof lastUserMsg?.content === 'string' ? lastUserMsg.content : '';
            if (queryText) {
              void this.semanticCache.setCachedResponse({
                useCase: opts.useCase,
                query: queryText,
                systemPrompt: opts.system,
                scope: opts.cacheScope ?? 'user',
                userId: opts.userId,
                response: {
                  text: result.text,
                  modelId: pm.model,
                  providerId: pm.provider,
                  promptTokens: result.usage.promptTokens,
                  completionTokens: result.usage.completionTokens,
                  originalCostUsd: costUsd,
                  cachedAt: new Date().toISOString(),
                },
                ttlSec: opts.cacheTtlSec,
              });
            }
          }

          return {
            text: result.text,
            promptTokens: result.usage.promptTokens,
            completionTokens: result.usage.completionTokens,
            modelId: pm.model,
            providerId: pm.provider,
            costUsd,
          };
        });
      } catch (err) {
        lastError = err as Error;
        if (err instanceof CircuitOpenError) continue;
        logger.warn('ai-router.provider_failed', {
          circuit: circuitName,
          error: err instanceof Error ? err.message : String(err),
        });
        continue;
      }
    }

    throw new AllProvidersFailedError(`Tất cả ${chain.length} provider thất bại`, lastError);
  }

  /** Helper: thực sự stream từ 1 provider — onFinish record cost + resolve finishPromise. */
  private executeStream(args: {
    model: LanguageModel;
    providerModel: ProviderModel;
    opts: RoutedStreamOptions;
    maxOut: number;
  }): RoutedStreamResult {
    const { model, providerModel, opts, maxOut } = args;

    // Decide prompt caching — default ON cho Anthropic + system đủ dài.
    const enableCache =
      (opts.enablePromptCache ?? true) &&
      !!opts.system &&
      shouldEnableCache(providerModel.provider, opts.system.length);

    // Build messages: cached pattern (system in array với cacheControl) hoặc raw.
    let finalMessages: CoreMessage[];
    let finalSystem: string | undefined;
    if (enableCache && opts.system) {
      const cachedMsgs = buildCachedMessages(opts.system, opts.messages);
      if (cachedMsgs) {
        finalMessages = cachedMsgs;
        finalSystem = undefined; // system trong messages array rồi
      } else {
        finalMessages = opts.messages;
        finalSystem = opts.system;
      }
    } else {
      finalMessages = opts.messages;
      finalSystem = opts.system;
    }

    let resolveFinish!: (v: RoutedFinishInfo) => void;
    let rejectFinish!: (e: unknown) => void;
    const finishPromise = new Promise<RoutedFinishInfo>((resolve, reject) => {
      resolveFinish = resolve;
      rejectFinish = reject;
    });

    const guardrail = this.guardrail;
    const semanticCache = this.semanticCache;

    const result = streamText({
      model,
      system: finalSystem,
      messages: finalMessages,
      maxTokens: maxOut,
      abortSignal: opts.timeoutMs ? AbortSignal.timeout(opts.timeoutMs) : undefined,
      onFinish: async ({ text, usage, providerMetadata }) => {
        // Parse cache stats — chỉ Anthropic populate
        const cacheStats = extractCacheStats(providerMetadata);

        const costUsd = calcCostUsd(providerModel.model, usage.promptTokens, usage.completionTokens);

        // Record actual cost — không block stream.
        await guardrail.record({
          userId: opts.userId,
          plan: opts.plan,
          actualCostUsd: costUsd,
          model: providerModel.model,
          feature: opts.feature ?? opts.useCase,
          provider: providerModel.provider,
          tokensIn: usage.promptTokens,
          tokensOut: usage.completionTokens,
        });

        // Save vào semantic cache nếu enabled (best-effort)
        if (opts.enableSemanticCache && opts.system) {
          const lastUserMsg = [...opts.messages].reverse().find((m) => m.role === 'user');
          const queryText = typeof lastUserMsg?.content === 'string' ? lastUserMsg.content : '';
          if (queryText && text) {
            void semanticCache.setCachedResponse({
              useCase: opts.useCase,
              query: queryText,
              systemPrompt: opts.system,
              scope: opts.cacheScope ?? 'user',
              userId: opts.userId,
              ttlSec: opts.cacheTtlSec,
              response: {
                text,
                modelId: providerModel.model,
                providerId: providerModel.provider,
                promptTokens: usage.promptTokens,
                completionTokens: usage.completionTokens,
                originalCostUsd: costUsd,
                cachedAt: new Date().toISOString(),
              },
            });
          }
        }

        logger.info('ai-router.completed', {
          use_case: opts.useCase,
          provider: providerModel.provider,
          model: providerModel.model,
          prompt_tokens: usage.promptTokens,
          completion_tokens: usage.completionTokens,
          cost_usd: costUsd,
          user_id: opts.userId,
          feature: opts.feature,
          cache_hit: cacheStats.cacheHit,
          cache_read_tokens: cacheStats.cacheReadTokens,
          cache_creation_tokens: cacheStats.cacheCreationTokens,
        });

        resolveFinish({
          text,
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          modelId: providerModel.model,
          providerId: providerModel.provider,
          costUsd,
          cacheHit: cacheStats.cacheHit,
          cacheReadTokens: cacheStats.cacheReadTokens,
        });
      },
      onError: ({ error }) => {
        logger.error('ai-router.stream_error', {
          use_case: opts.useCase,
          provider: providerModel.provider,
          error: error instanceof Error ? error.message : String(error),
        });
        rejectFinish(error);
      },
    });

    return {
      textStream: result.textStream,
      finishPromise,
      providerUsed: providerModel.provider,
      modelUsed: providerModel.model,
      result,
    };
  }
}

/**
 * Build RoutedStreamResult từ cached response — mimic streamText interface.
 * costUsd=0 + cacheHit=true; result raw là STUB — caller phải kiểm cacheHit
 * trước khi dùng mergeIntoDataStream.
 */
function buildCachedResult(cached: CachedResponse): RoutedStreamResult {
  const stream = streamCachedText(cached.text);
  const finish = Promise.resolve({
    text: cached.text,
    promptTokens: cached.promptTokens,
    completionTokens: cached.completionTokens,
    modelId: cached.modelId,
    providerId: cached.providerId as ProviderId,
    costUsd: 0, // cache hit = free
    cacheHit: true, // wire semantic hit qua field này (reuse Anthropic field)
    cacheReadTokens: cached.promptTokens,
  });
  return {
    textStream: stream,
    finishPromise: finish,
    providerUsed: cached.providerId as ProviderId,
    modelUsed: cached.modelId,
    // Stub result — caller phải check cacheHit trước khi dùng mergeIntoDataStream
    result: {
      textStream: stream,
    } as unknown as StreamTextResult,
  };
}
