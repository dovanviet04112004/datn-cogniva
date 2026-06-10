/**
 * /api/reports — port từ route Next (apps/web/src/app/api/reports/route.ts).
 * Guard mặc định lo 401; route cũ trả 201 khi tạo = Nest POST mặc định.
 */
import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/auth/session.types';
import { ReportsService } from './reports.service';
import { createReportSchema, type CreateReportInput } from './dto/notifications.dto';

@ApiTags('reports')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  /** POST /reports — báo cáo nội dung vi phạm (201 | 400 | 404 | 409). */
  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createReportSchema)) body: CreateReportInput,
  ) {
    return this.reports.createReport(user.id, body);
  }
}
