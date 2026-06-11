import {
  Body,
  Controller,
  Delete,
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
import { AdminDocumentsService } from './admin-documents.service';
import { adminReasonSchema, type AdminReasonInput } from './dto/admin-domain.dto';

@ApiTags('admin')
@UseGuards(AdminGuard)
@Controller('admin')
export class AdminDocumentsController {
  constructor(private readonly documents: AdminDocumentsService) {}

  @Get('documents')
  list(
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('mime') mime?: string,
    @Query('userEmail') userEmail?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.documents.list({ q, status, mime, userEmail, cursor, limit });
  }

  @Get('documents/:id')
  detail(@Param('id') id: string) {
    return this.documents.getDetail(id);
  }

  @Delete('documents/:id')
  @AdminRoles('SUPER_ADMIN', 'ADMIN')
  remove(
    @AdminCtx() ctx: AdminContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(adminReasonSchema)) body: AdminReasonInput,
  ) {
    return this.documents.delete(ctx, id, body.reason);
  }

  @Post('documents/:id/reingest')
  @AdminRoles('SUPER_ADMIN', 'ADMIN')
  @HttpCode(200)
  reingest(
    @AdminCtx() ctx: AdminContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(adminReasonSchema)) body: AdminReasonInput,
  ) {
    return this.documents.reingest(ctx, id, body.reason);
  }
}
