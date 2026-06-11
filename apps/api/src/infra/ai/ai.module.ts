import { Global, Module } from '@nestjs/common';

import { RedisModule } from '../redis/redis.module';
import { CircuitBreakerService } from './circuit-breaker.service';
import { CostGuardrailService } from './cost-guardrail.service';
import { EmbeddingService } from './embedding.service';
import { LlmService } from './llm.service';
import { RouterService } from './router.service';
import { SemanticCacheService } from './semantic-cache.service';

@Global()
@Module({
  imports: [RedisModule],
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
