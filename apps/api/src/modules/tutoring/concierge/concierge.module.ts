/**
 * TutoringConciergeModule — Wave 6, AI Concierge marketplace gia sư
 * (/api/tutoring/concierge/**): threads CRUD + agent loop SSE (planner LLM
 * → clarify/search/tutor_detail/faq/library_search).
 *
 * Import LibrarySearchModule để dùng lại HybridSearchService (action
 * library_search — cross-domain y bản web import lib/library).
 * Prisma/Llm/Embedding/CostGuardrail đều @Global → không cần imports.
 */
import { Module } from '@nestjs/common';

import { LibrarySearchModule } from '../../library/library-search.module';
import { ConciergeAgentService } from './concierge-agent.service';
import { ConciergeController } from './concierge.controller';
import { ConciergeService } from './concierge.service';
import { TutorDetailResolverService } from './tutor-detail-resolver.service';
import { TutorSearchService } from './tutor-search.service';

@Module({
  imports: [LibrarySearchModule],
  controllers: [ConciergeController],
  providers: [
    ConciergeService,
    ConciergeAgentService,
    TutorSearchService,
    TutorDetailResolverService,
  ],
})
export class TutoringConciergeModule {}
