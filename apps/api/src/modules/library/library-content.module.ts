import { Module } from '@nestjs/common';

import { AtomExtractorService } from './atom-extractor.service';
import { KarmaService } from './karma.service';
import { LibraryAccessService } from './library-access.service';
import { LibraryContentController } from './library-content.controller';
import { LibraryLlmService } from './library-llm.service';
import { LibraryEnrichController } from './library-enrich.controller';
import { LibraryEnrichService } from './library-enrich.service';
import { LibraryFilesService } from './library-files.service';
import { LibraryImportService } from './library-import.service';
import { LibraryIngestService } from './library-ingest.service';
import { LibraryMoneyController } from './library-money.controller';
import { LibraryMoneyService } from './library-money.service';
import { LibraryRateLimitService } from './library-rate-limit.service';
import { LibraryUploadService } from './library-upload.service';
import { LibraryWalletService } from './library-wallet.service';
import { QualityScoreService } from './quality-score.service';

/**
 * LibraryContentModule — Wave 5 nhóm CONTENT/MONEY của /api/library/**:
 * upload 2 bước (presigned R2 + ingest pipeline), import workspace (single +
 * batch), file proxy/download (PRO gate 402), purchase/subscribe/cancel-pro
 * (wallet stub), endorse/remix/atoms/translate/podcast/admin-quality.
 *
 * Module RIÊNG cùng mount path 'library' (như channels W4) — KHÔNG đụng
 * LibraryModule (OutcomeTracker) và các module library khác cùng wave.
 * Exports access/karma/quality cho module khác nối side-effect (vd quiz/exam
 * submit → recompute quality).
 */
@Module({
  controllers: [LibraryContentController, LibraryMoneyController, LibraryEnrichController],
  providers: [
    LibraryAccessService,
    KarmaService,
    QualityScoreService,
    LibraryRateLimitService,
    LibraryWalletService,
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
