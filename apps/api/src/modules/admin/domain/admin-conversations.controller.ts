import { Body, Controller, Delete, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import {
  AdminCtx,
  AdminGuard,
  AdminRoles,
  type AdminContext,
} from '../../../common/admin/admin.guard';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { AdminConversationsService } from './admin-conversations.service';
import { adminReasonSchema, type AdminReasonInput } from './dto/admin-domain.dto';

@ApiTags('admin')
@UseGuards(AdminGuard)
@Controller('admin')
export class AdminConversationsController {
  constructor(private readonly conversations: AdminConversationsService) {}

  @Get('conversations')
  list(
    @Query('q') q?: string,
    @Query('userEmail') userEmail?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.conversations.list({ q, userEmail, cursor, limit });
  }

  @Get('conversations/:id')
  detail(@Param('id') id: string) {
    return this.conversations.getDetail(id);
  }

  @Delete('conversations/:id')
  @AdminRoles('SUPER_ADMIN', 'ADMIN')
  removeConversation(
    @AdminCtx() ctx: AdminContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(adminReasonSchema)) body: AdminReasonInput,
  ) {
    return this.conversations.deleteConversation(ctx, id, body.reason);
  }

  @Delete('recordings/:id')
  @AdminRoles('SUPER_ADMIN', 'ADMIN')
  removeRecording(
    @AdminCtx() ctx: AdminContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(adminReasonSchema)) body: AdminReasonInput,
  ) {
    return this.conversations.deleteRecording(ctx, id, body.reason);
  }
}
