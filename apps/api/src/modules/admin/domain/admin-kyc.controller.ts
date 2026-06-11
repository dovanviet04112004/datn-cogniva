import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
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

  @Get('kyc')
  list(@Query('status') status?: string) {
    return this.kyc.listQueue(status);
  }

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
