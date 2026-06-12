import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';

import {
  AdminCtx,
  AdminGuard,
  AdminRoles,
  type AdminContext,
} from '../../../common/admin/admin.guard';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { AdminMiscService, IMPERSONATION_COOKIE_NAME } from './admin-misc.service';
import { impersonateSchema, type ImpersonateInput } from './dto/admin-core.dto';

@ApiTags('admin')
@UseGuards(AdminGuard)
@Controller('admin')
export class AdminMiscController {
  constructor(private readonly misc: AdminMiscService) {}

  @Get('dashboard')
  dashboard() {
    return this.misc.dashboard();
  }

  @Get('audit')
  audit(
    @Query('adminEmail') adminEmail?: string,
    @Query('action') action?: string,
    @Query('targetType') targetType?: string,
    @Query('targetId') targetId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.misc.listAudit({
      adminEmail,
      action,
      targetType,
      targetId,
      from,
      to,
      cursor,
      limit,
    });
  }

  @Get('search')
  search(@Query('q') q?: string) {
    return this.misc.search(q);
  }

  @Post('impersonate')
  @HttpCode(200)
  @AdminRoles('SUPER_ADMIN', 'ADMIN')
  impersonate(
    @AdminCtx() ctx: AdminContext,
    @Body(new ZodValidationPipe(impersonateSchema)) dto: ImpersonateInput,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.misc.startImpersonation(ctx, dto, res);
  }

  @Delete('impersonate')
  @AdminRoles('SUPER_ADMIN', 'ADMIN')
  stopImpersonate(
    @AdminCtx() ctx: AdminContext,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const raw = req.headers.cookie
      ?.split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${IMPERSONATION_COOKIE_NAME}=`))
      ?.slice(IMPERSONATION_COOKIE_NAME.length + 1);
    return this.misc.stopImpersonation(ctx, raw, res);
  }
}
