/**
 * /api/admin/kyc/* — port từ apps/web/src/app/api/admin/kyc/**.
 *
 * Route web LEGACY auth bằng isAdminEmail (env allowlist, trả 403 mọi nhánh)
 * + PATCH không audit. Api ĐỒNG NHẤT sang AdminGuard (401/403 semantics
 * chuẩn) + withAudit cho PATCH — deviation có chủ đích theo khảo sát.
 */
import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import {
  AdminCtx,
  AdminGuard,
  AdminRoles,
  type AdminContext,
} from '../../../common/admin/admin.guard';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { AdminKycService } from './admin-kyc.service';
import { kycReviewSchema, type KycReviewInput } from './dto/admin-domain.dto';

@ApiTags('admin')
@UseGuards(AdminGuard)
@Controller('admin')
export class AdminKycController {
  constructor(private readonly kyc: AdminKycService) {}

  /** GET /admin/kyc — queue group theo tutor (?status default PENDING). */
  @Get('kyc')
  list(@Query('status') status?: string) {
    return this.kyc.listQueue(status);
  }

  /** PATCH /admin/kyc/:id — approve/reject doc + recompute tutor verification. */
  @Patch('kyc/:id')
  @AdminRoles('SUPER_ADMIN', 'ADMIN')
  review(
    @AdminCtx() ctx: AdminContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(kycReviewSchema)) body: KycReviewInput,
  ) {
    return this.kyc.review(ctx, id, body);
  }
}
