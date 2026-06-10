import { Global, Module } from '@nestjs/common';

import { CostGuardrailService } from './cost-guardrail.service';
import { EmbeddingService } from './embedding.service';
import { LlmService } from './llm.service';

/**
 * AiModule — @Global: LLM 1-lượt (REST OpenAI-compatible), embedding
 * (Voyage/OpenAI) và cost-guardrail dùng chung mọi domain module. Wave 7
 * thay LlmService bằng infra/ai router DI đầy đủ (guardrail/circuit/cache).
 */
@Global()
@Module({
  providers: [LlmService, EmbeddingService, CostGuardrailService],
  exports: [LlmService, EmbeddingService, CostGuardrailService],
})
export class AiModule {}
