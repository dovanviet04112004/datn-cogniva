/**
 * LibraryAnnotationsModule — Wave 5: annotations + saved-searches trên
 * /api/library/** (3 cron đi kèm nằm ở modules/jobs). Module RIÊNG cùng mount
 * path 'library' (hợp lệ như channels W4) — KHÔNG đụng LibraryModule
 * (OutcomeTracker stub) hay module của agent khác.
 * PrismaService + TokenService/LegacySessionService đều @Global → không cần imports.
 */
import { Module } from '@nestjs/common';

import { LibraryAnnotationsController } from './library-annotations.controller';
import { LibraryAnnotationsService } from './library-annotations.service';
import { LibrarySavedSearchesController } from './library-saved-searches.controller';
import { LibrarySavedSearchesService } from './library-saved-searches.service';

@Module({
  controllers: [LibraryAnnotationsController, LibrarySavedSearchesController],
  providers: [LibraryAnnotationsService, LibrarySavedSearchesService],
})
export class LibraryAnnotationsModule {}
