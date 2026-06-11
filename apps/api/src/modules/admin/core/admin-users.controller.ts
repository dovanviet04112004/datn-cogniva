import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
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
import { AdminUsersService } from './admin-users.service';
import {
  adminPatchUserSchema,
  adminReasonSchema,
  type AdminPatchUserInput,
  type AdminReasonInput,
} from './dto/admin-core.dto';

@ApiTags('admin')
@UseGuards(AdminGuard)
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly users: AdminUsersService) {}

  @Get()
  list(
    @Query('q') q?: string,
    @Query('plan') plan?: string,
    @Query('status') status?: string,
    @Query('adminOnly') adminOnly?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.users.listUsers({ q, plan, status, adminOnly, cursor, limit });
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.users.getUser(id);
  }

  @Patch(':id')
  @AdminRoles('SUPER_ADMIN', 'ADMIN')
  patch(
    @AdminCtx() ctx: AdminContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(adminPatchUserSchema)) dto: AdminPatchUserInput,
  ) {
    return this.users.patchUser(ctx, id, dto);
  }

  @Post(':id/suspend')
  @HttpCode(200)
  @AdminRoles('SUPER_ADMIN', 'ADMIN')
  suspend(
    @AdminCtx() ctx: AdminContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(adminReasonSchema)) dto: AdminReasonInput,
  ) {
    return this.users.suspendUser(ctx, id, dto.reason);
  }

  @Post(':id/unsuspend')
  @HttpCode(200)
  @AdminRoles('SUPER_ADMIN', 'ADMIN')
  unsuspend(
    @AdminCtx() ctx: AdminContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(adminReasonSchema)) dto: AdminReasonInput,
  ) {
    return this.users.unsuspendUser(ctx, id, dto.reason);
  }

  @Post(':id/force-signout')
  @HttpCode(200)
  forceSignout(
    @AdminCtx() ctx: AdminContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(adminReasonSchema)) dto: AdminReasonInput,
  ) {
    return this.users.forceSignout(ctx, id, dto.reason);
  }
}
