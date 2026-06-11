/**
 * /api/admin/groups/** — list/detail/suspend/unsuspend/delete/recordings.
 * LƯU Ý: hard delete là POST :id/delete (không phải DELETE method) — giữ
 * nguyên mapping route cũ. Delete chỉ SUPER_ADMIN; suspend/unsuspend thêm ADMIN.
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
import { AdminGroupsService } from './admin-groups.service';
import { adminReasonSchema, type AdminReasonInput } from './dto/admin-core.dto';

@ApiTags('admin')
@UseGuards(AdminGuard)
@Controller('admin/groups')
export class AdminGroupsController {
  constructor(private readonly groups: AdminGroupsService) {}

  @Get()
  list(
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.groups.listGroups({ q, status, cursor, limit });
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.groups.getGroup(id);
  }

  @Post(':id/suspend')
  @HttpCode(200)
  @AdminRoles('SUPER_ADMIN', 'ADMIN')
  suspend(
    @AdminCtx() ctx: AdminContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(adminReasonSchema)) dto: AdminReasonInput,
  ) {
    return this.groups.suspendGroup(ctx, id, dto.reason);
  }

  @Post(':id/unsuspend')
  @HttpCode(200)
  @AdminRoles('SUPER_ADMIN', 'ADMIN')
  unsuspend(
    @AdminCtx() ctx: AdminContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(adminReasonSchema)) dto: AdminReasonInput,
  ) {
    return this.groups.unsuspendGroup(ctx, id, dto.reason);
  }

  @Post(':id/delete')
  @HttpCode(200)
  @AdminRoles('SUPER_ADMIN')
  remove(
    @AdminCtx() ctx: AdminContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(adminReasonSchema)) dto: AdminReasonInput,
  ) {
    return this.groups.deleteGroup(ctx, id, dto.reason);
  }

  @Get(':id/recordings')
  recordings(@Param('id') id: string) {
    return this.groups.listRecordings(id);
  }
}
