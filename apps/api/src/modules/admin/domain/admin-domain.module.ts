import { Module } from '@nestjs/common';

import { QueueModule } from '../../../infra/queue/queue.module';
import { AdminGuard } from '../../../common/admin/admin.guard';
import { AdminAuditService } from '../../../common/admin/admin-audit.service';
import { AdminAiController } from './admin-ai.controller';
import { AdminAiService } from './admin-ai.service';
import { AdminConversationsController } from './admin-conversations.controller';
import { AdminConversationsService } from './admin-conversations.service';
import { AdminDocumentsController } from './admin-documents.controller';
import { AdminDocumentsService } from './admin-documents.service';
import { AdminKycController } from './admin-kyc.controller';
import { AdminKycService } from './admin-kyc.service';
import { AdminTutoringController } from './admin-tutoring.controller';
import { AdminTutoringService } from './admin-tutoring.service';

@Module({
  imports: [QueueModule],
  controllers: [
    AdminDocumentsController,
    AdminConversationsController,
    AdminKycController,
    AdminTutoringController,
    AdminAiController,
  ],
  providers: [
    AdminGuard,
    AdminAuditService,
    AdminDocumentsService,
    AdminConversationsService,
    AdminKycService,
    AdminTutoringService,
    AdminAiService,
  ],
})
export class AdminDomainModule {}
