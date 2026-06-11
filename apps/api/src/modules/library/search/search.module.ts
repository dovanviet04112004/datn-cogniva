import { Module } from '@nestjs/common';

import { CrossDocSearchService } from './cross-doc-search.service';
import { GoalPlannerService } from './goal-planner.service';
import { HybridSearchService } from './hybrid-search.service';
import { LibraryCatalogController } from './catalog.controller';
import { LibraryCatalogService } from './catalog.service';
import { LibraryDocsController } from './docs.controller';
import { LibraryDocsService } from './docs.service';
import { LibraryLlmService } from '../shared/llm.service';
import { LibrarySearchController } from './search.controller';
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
  exports: [HybridSearchService],
})
export class LibrarySearchModule {}
