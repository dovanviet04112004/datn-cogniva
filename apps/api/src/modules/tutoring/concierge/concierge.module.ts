import { Module } from '@nestjs/common';

import { LibrarySearchModule } from '../../library/search/search.module';
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
