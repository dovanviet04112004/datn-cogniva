/**
 * /api/admin/ai/* — port từ apps/web/src/app/api/admin/ai/**.
 * usage hỗ trợ format=csv (content-disposition attachment) — set header thủ
 * công qua @Res passthrough vì content-type động theo query.
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import {
  AdminCtx,
  AdminGuard,
  AdminRoles,
  type AdminContext,
} from '../../../common/admin/admin.guard';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { AdminAiService } from './admin-ai.service';
import { circuitResetSchema, type CircuitResetInput } from './dto/admin-domain.dto';

@ApiTags('admin')
@UseGuards(AdminGuard)
@Controller('admin')
export class AdminAiController {
  constructor(private readonly ai: AdminAiService) {}

  /** GET /admin/ai/circuits — circuit breaker state (healthy không hiện). */
  @Get('ai/circuits')
  circuits() {
    return this.ai.listCircuits();
  }

  /** POST /admin/ai/circuits/reset — force CLOSED 1 circuit. */
  @Post('ai/circuits/reset')
  @AdminRoles('SUPER_ADMIN', 'ADMIN')
  @HttpCode(200)
  resetCircuit(
    @AdminCtx() ctx: AdminContext,
    @Body(new ZodValidationPipe(circuitResetSchema)) body: CircuitResetInput,
  ) {
    return this.ai.resetCircuit(ctx, body.name, body.reason);
  }

  /** GET /admin/ai/cost — aggregate cost dashboard (?days=1..90). */
  @Get('ai/cost')
  cost(@Query('days') days?: string) {
    return this.ai.cost(days);
  }

  /** GET /admin/ai/usage — per-user usage; format=csv → text/csv attachment. */
  @Get('ai/usage')
  async usage(
    @Res({ passthrough: true }) res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('provider') provider?: string,
    @Query('feature') feature?: string,
    @Query('userEmail') userEmail?: string,
    @Query('format') format?: string,
    @Query('limit') limit?: string,
  ) {
    const out = await this.ai.usage({ from, to, provider, feature, userEmail, format, limit });
    if (out.kind === 'csv') {
      res.set({
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${out.filename}"`,
      });
      return out.csv;
    }
    return out.body;
  }
}
