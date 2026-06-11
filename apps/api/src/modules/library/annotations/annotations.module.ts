import { Module } from '@nestjs/common';

import { LibraryAnnotationsController } from './annotations.controller';
import { LibraryAnnotationsService } from './annotations.service';
import { LibrarySavedSearchesController } from './saved-searches.controller';
import { LibrarySavedSearchesService } from './saved-searches.service';

@Module({
  controllers: [LibraryAnnotationsController, LibrarySavedSearchesController],
  providers: [LibraryAnnotationsService, LibrarySavedSearchesService],
})
export class LibraryAnnotationsModule {}
