import { Module } from '@nestjs/common';

import { ChunksController, SearchController } from './search.controller';
import { SearchService } from './search.service';

/** SearchModule — global search ILIKE + chunk preview (citation panel). */
@Module({
  controllers: [SearchController, ChunksController],
  providers: [SearchService],
})
export class SearchModule {}
