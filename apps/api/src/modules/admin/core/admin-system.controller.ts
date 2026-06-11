import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
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
import { AdminSystemService } from './admin-system.service';
import {
  FLAG_NAME,
  setFlagSchema,
  setMaintenanceSchema,
  type SetFlagInput,
  type SetMaintenanceInput,
} from './dto/admin-core.dto';

@ApiTags('admin')
@UseGuards(AdminGuard)
@Controller('admin/system')
export class AdminSystemController {
  constructor(private readonly system: AdminSystemService) {}

  @Get('flags')
  listFlags() {
    return this.system.listFlags();
  }

  @Post('flags')
  @HttpCode(200)
  @AdminRoles('SUPER_ADMIN')
  setFlag(
    @AdminCtx() ctx: AdminContext,
    @Body(new ZodValidationPipe(setFlagSchema)) dto: SetFlagInput,
  ) {
    return this.system.setFlag(ctx, dto);
  }

  @Delete('flags')
  @AdminRoles('SUPER_ADMIN')
  deleteFlag(
    @AdminCtx() ctx: AdminContext,
    @Query('name') name?: string,
    @Query('reason') reason?: string,
  ) {
    const r = reason ?? '';
    if (!name || !FLAG_NAME.test(name)) {
      throw new BadRequestException({ error: 'Tên flag không hợp lệ' });
    }
    if (r.trim().length < 10) {
      throw new BadRequestException({ error: 'Reason cần ≥ 10 ký tự' });
    }
    return this.system.deleteFlag(ctx, name, r);
  }

  @Get('maintenance')
  getMaintenance() {
    return this.system.getMaintenance();
  }

  @Post('maintenance')
  @HttpCode(200)
  @AdminRoles('SUPER_ADMIN')
  setMaintenance(
    @AdminCtx() ctx: AdminContext,
    @Body(new ZodValidationPipe(setMaintenanceSchema)) dto: SetMaintenanceInput,
  ) {
    return this.system.setMaintenance(ctx, dto);
  }

  @Get('jobs')
  jobs() {
    return this.system.getJobs();
  }
}
