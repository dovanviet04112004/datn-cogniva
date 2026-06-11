import { Injectable } from '@nestjs/common';
import { streamText, generateText, type LanguageModel, type CoreMessage } from 'ai';
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

type ProviderId = 'anthropic' | 'openrouter' | 'openai' | 'groq' | 'google';
type ModelId = string;

type ProviderModel = {
  provider: ProviderId;
  model: ModelId;
  inputPerM: number;
  outputPerM: number;
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

export type UseCase =
  | 'ragChat'
  | 'reasoning'
  | 'classify'
  | 'roomTutor'
  | 'flashcardGen'
  | 'quizGen'
  | 'noteComplete'
  | 'summarize';

type Route = {
  primary: keyof typeof PROVIDERS;
  fallback: Array<keyof typeof PROVIDERS>;
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

function getProviderChain(useCase: UseCase): ProviderModel[] {
  const route = ROUTES[useCase];
  const chain = [route.primary, ...route.fallback];
  return chain.map((id) => PROVIDERS[id]!).filter((p) => p.isAvailable());
}

const MODEL_PRICING: Record<string, { inputPerM: number; outputPerM: number }> = {
  'claude-sonnet-4-6': { inputPerM: 3, outputPerM: 15 },
  'claude-sonnet-4-5': { inputPerM: 3, outputPerM: 15 },
  'claude-haiku-4-5': { inputPerM: 0.25, outputPerM: 1.25 },
  'claude-opus-4-7': { inputPerM: 15, outputPerM: 75 },
  'gemini-2.0-flash': { inputPerM: 0.075, outputPerM: 0.3 },
  'voyage-3': { inputPerM: 0.18, outputPerM: 0 },
  'voyage-3-large': { inputPerM: 0.18, outputPerM: 0 },
};

function calcCostUsd(modelId: string, promptTokens: number, completionTokens: number): number {
  const pricing = MODEL_PRICING[modelId];
  if (!pricing) return 0;
  const cost =
    (promptTokens * pricing.inputPerM + completionTokens * pricing.outputPerM) / 1_000_000;
  return Number(cost.toFixed(6));
}

function estimateCostUsd(args: {
  inputTokens: number;
  maxOutputTokens: number;
  inputPerMUsd: number;
  outputPerMUsd: number;
}): number {
  return (
    (args.inputTokens * args.inputPerMUsd + args.maxOutputTokens * args.outputPerMUsd) / 1_000_000
  );
}

const MIN_CACHE_CHARS = 3_500;

function estimateTokensFromChars(text: string): number {
  return Math.ceil(text.length / 3);
}

function shouldEnableCache(provider: string, systemLength: number): boolean {
  if (provider !== 'anthropic') return false;
  if (systemLength < MIN_CACHE_CHARS) return false;
  return true;
}

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

export type RoutedStreamOptions = {
  useCase: UseCase;
  userId: string;
  plan: Plan;
  estimatedInputTokens?: number;
  system?: string;
  messages: CoreMessage[];
  maxOutputTokens?: number;
  feature?: string;
  timeoutMs?: number;
  enablePromptCache?: boolean;
  enableSemanticCache?: boolean;
  cacheScope?: CacheScope;
  cacheTtlSec?: number;
};

export type RoutedFinishInfo = {
  text: string;
  promptTokens: number;
  completionTokens: number;
  modelId: string;
  providerId: ProviderId;
  costUsd: number;
  cacheHit: boolean;
  cacheReadTokens: number;
};

export type RoutedStreamResult = {
  textStream: AsyncIterable<string>;
  finishPromise: Promise<RoutedFinishInfo>;
  providerUsed: ProviderId;
  modelUsed: ModelId;
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

function estimateInputTokens(opts: RoutedStreamOptions): number {
  const systemLen = opts.system?.length ?? 0;
  const messagesLen = opts.messages.reduce((sum, m) => {
    if (typeof m.content === 'string') return sum + m.content.length;
    return sum + 100;
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

    const primary = chain[0]!;
    const estimatedInput = opts.estimatedInputTokens ?? estimateInputTokens(opts);
    const estimatedCost = estimateCostUsd({
      inputTokens: estimatedInput,
      maxOutputTokens: maxOut,
      inputPerMUsd: primary.inputPerM,
      outputPerMUsd: primary.outputPerM,
    });

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
          return buildCachedResult(cachedResp);
        }
      }
    }

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
          continue;
        }
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
            costUsd: 0,
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

          if (opts.enableSemanticCache && opts.system) {
            const lastUserMsg = [...opts.messages].reverse().find((m) => m.role === 'user');
            const queryText = typeof lastUserMsg?.content === 'string' ? lastUserMsg.content : '';
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

  private executeStream(args: {
    model: LanguageModel;
    providerModel: ProviderModel;
    opts: RoutedStreamOptions;
    maxOut: number;
  }): RoutedStreamResult {
    const { model, providerModel, opts, maxOut } = args;

    const enableCache =
      (opts.enablePromptCache ?? true) &&
      !!opts.system &&
      shouldEnableCache(providerModel.provider, opts.system.length);

    let finalMessages: CoreMessage[];
    let finalSystem: string | undefined;
    if (enableCache && opts.system) {
      const cachedMsgs = buildCachedMessages(opts.system, opts.messages);
      if (cachedMsgs) {
        finalMessages = cachedMsgs;
        finalSystem = undefined;
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
        const cacheStats = extractCacheStats(providerMetadata);

        const costUsd = calcCostUsd(
          providerModel.model,
          usage.promptTokens,
          usage.completionTokens,
        );

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

function buildCachedResult(cached: CachedResponse): RoutedStreamResult {
  const stream = streamCachedText(cached.text);
  const finish = Promise.resolve({
    text: cached.text,
    promptTokens: cached.promptTokens,
    completionTokens: cached.completionTokens,
    modelId: cached.modelId,
    providerId: cached.providerId as ProviderId,
    costUsd: 0,
    cacheHit: true,
    cacheReadTokens: cached.promptTokens,
  });
  return {
    textStream: stream,
    finishPromise: finish,
    providerUsed: cached.providerId as ProviderId,
    modelUsed: cached.modelId,
    result: {
      textStream: stream,
    } as unknown as StreamTextResult,
  };
}
