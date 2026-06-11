/**
 * /api/admin/moderation/** — reports list + context snippet + resolve + banned.
 * Resolve cần SUPER_ADMIN/ADMIN (side-effect destructive); còn lại read-only
 * mọi role.
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
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
import { AdminModerationService } from './admin-moderation.service';
import { resolveReportSchema, type ResolveReportInput } from './dto/admin-core.dto';

@ApiTags('admin')
@UseGuards(AdminGuard)
@Controller('admin/moderation')
export class AdminModerationController {
  constructor(private readonly moderation: AdminModerationService) {}

  @Get('reports')
  reports(
    @Query('status') status?: string,
    @Query('targetType') targetType?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.moderation.listReports({ status, targetType, cursor, limit });
  }

  @Get('context')
  context(@Query('type') type?: string, @Query('id') id?: string) {
    return this.moderation.getContext(type, id);
  }

  @Post('reports/:id/resolve')
  @HttpCode(200)
  @AdminRoles('SUPER_ADMIN', 'ADMIN')
  resolve(
    @AdminCtx() ctx: AdminContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(resolveReportSchema)) dto: ResolveReportInput,
  ) {
    return this.moderation.resolveReport(ctx, id, dto);
  }

  @Get('banned')
  banned(
    @Query('type') type?: string,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
  ) {
    return this.moderation.listBanned({ type, q, limit });
  }
}
