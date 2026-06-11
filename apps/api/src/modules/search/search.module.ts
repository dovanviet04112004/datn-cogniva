import { Module } from '@nestjs/common';

import { ChunksController, SearchController } from './search.controller';
import { SearchService } from './search.service';

@Module({
  controllers: [SearchController, ChunksController],
  providers: [SearchService],
})
export class SearchModule {}
