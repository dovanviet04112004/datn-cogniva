import { Module } from '@nestjs/common';

import { PaymentsModule } from '../../payments/payments.module';
import { AtomExtractorService } from './atom-extractor.service';
import { KarmaService } from './karma.service';
import { LibraryAccessService } from './access.service';
import { LibraryContentController } from './content.controller';
import { LibraryLlmService } from '../shared/llm.service';
import { LibraryEnrichController } from './enrich.controller';
import { LibraryEnrichService } from './enrich.service';
import { LibraryFilesService } from './files.service';
import { LibraryImportService } from './import.service';
import { LibraryIngestService } from './ingest.service';
import { LibraryMoneyController } from './money.controller';
import { LibraryMoneyService } from './money.service';
import { LibraryRateLimitService } from './rate-limit.service';
import { LibraryUploadService } from './upload.service';
import { QualityScoreService } from './quality-score.service';

@Module({
  imports: [PaymentsModule],
  controllers: [LibraryContentController, LibraryMoneyController, LibraryEnrichController],
  providers: [
    LibraryAccessService,
    KarmaService,
    QualityScoreService,
    LibraryRateLimitService,
    LibraryLlmService,
    AtomExtractorService,
    LibraryIngestService,
    LibraryUploadService,
    LibraryImportService,
    LibraryFilesService,
    LibraryMoneyService,
    LibraryEnrichService,
  ],
  exports: [LibraryAccessService, KarmaService, QualityScoreService],
})
export class LibraryContentModule {}
