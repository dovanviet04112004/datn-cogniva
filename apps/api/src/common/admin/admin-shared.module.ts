import { Module } from '@nestjs/common';

import { AdminAuditService } from './admin-audit.service';
import { AdminGuard } from './admin.guard';

@Module({
  providers: [AdminGuard, AdminAuditService],
  exports: [AdminGuard, AdminAuditService],
})
export class AdminSharedModule {}
