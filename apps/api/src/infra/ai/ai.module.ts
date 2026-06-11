import { Global, Module } from '@nestjs/common';

import { CircuitBreakerService } from './circuit-breaker.service';
import { CostGuardrailService } from './cost-guardrail.service';
import { EmbeddingService } from './embedding.service';
import { LlmService } from './llm.service';
import { RouterService } from './router.service';
import { SemanticCacheService } from './semantic-cache.service';

/**
 * AiModule — @Global: LLM 1-lượt (REST OpenAI-compatible), embedding
 * (Voyage/OpenAI), cost-guardrail và circuit-breaker (Redis phân tán, key
 * cb:* dùng chung admin dashboard) cho mọi domain module. Wave 7 thêm
 * RouterService (chain provider AI SDK + fallback) cho streaming chat và
 * SemanticCacheService (exact-hash Redis, key aicache:* dùng chung web).
 */
@Global()
@Module({
  providers: [
    LlmService,
    EmbeddingService,
    CostGuardrailService,
    CircuitBreakerService,
    RouterService,
    SemanticCacheService,
  ],
  exports: [
    LlmService,
    EmbeddingService,
    CostGuardrailService,
    CircuitBreakerService,
    RouterService,
    SemanticCacheService,
  ],
})
export class AiModule {}
