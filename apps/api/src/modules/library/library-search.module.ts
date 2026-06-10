/**
 * LibrarySearchModule — Wave 5, mảng SEARCH/DISCOVERY của /api/library/**:
 * docs list/detail/delete, related/duplicates/prereq-check, reviews,
 * cross-doc/reverse/voice search, goal planner, universities/courses,
 * karma leaderboard (14 route cũ).
 *
 * Module RIÊNG cùng mount path 'library' với các module library khác của
 * Wave 5 (hợp lệ — như channels W4); KHÔNG đụng LibraryModule (OutcomeTracker).
 * Prisma/Llm/Embedding/CostGuardrail/TokenService/OptionalAuth đều @Global
 * → không imports.
 */
import { Module } from '@nestjs/common';

import { CrossDocSearchService } from './cross-doc-search.service';
import { GoalPlannerService } from './goal-planner.service';
import { HybridSearchService } from './hybrid-search.service';
import { LibraryCatalogController } from './library-catalog.controller';
import { LibraryCatalogService } from './library-catalog.service';
import { LibraryDocsController } from './library-docs.controller';
import { LibraryDocsService } from './library-docs.service';
import { LibraryLlmService } from './library-llm.service';
import { LibrarySearchController } from './library-search.controller';
import { ReverseSearchService } from './reverse-search.service';
import { VoiceSearchService } from './voice-search.service';

@Module({
  controllers: [LibraryDocsController, LibrarySearchController, LibraryCatalogController],
  providers: [
    HybridSearchService,
    CrossDocSearchService,
    LibraryDocsService,
    LibraryCatalogService,
    LibraryLlmService,
    ReverseSearchService,
    GoalPlannerService,
    VoiceSearchService,
  ],
})
export class LibrarySearchModule {}
