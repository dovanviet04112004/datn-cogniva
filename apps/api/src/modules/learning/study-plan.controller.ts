/**
 * /api/study-plan/* — port từ route Next (apps/web/src/app/api/study-plan/**).
 * Tất cả route đều cần session (guard mặc định lo 401 {error:'Unauthorized'}).
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/auth/session.types';
import { StudyPlanService } from './study-plan.service';
import {
  createStudyPlanSchema,
  patchStudyPlanSchema,
  type CreateStudyPlanInput,
  type PatchStudyPlanInput,
} from './dto/study-plan.dto';

@ApiTags('study-plan')
@Controller('study-plan')
export class StudyPlanController {
  constructor(private readonly studyPlan: StudyPlanService) {}

  /** GET /study-plan?status=&kind= — list theo filter, giá trị lạ bị bỏ qua. */
  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @Query('status') status?: string,
    @Query('kind') kind?: string,
  ) {
    const items = await this.studyPlan.listItems(user.id, {
      status: status ?? null,
      kind: kind ?? null,
    });
    return { items };
  }

  /** GET /study-plan/today — materialize proposal hôm nay (idempotent). */
  @Get('today')
  async today(@CurrentUser() user: AuthUser) {
    const items = await this.studyPlan.materializeProposalForToday(user.id);
    return { items };
  }

  /** POST /study-plan — tạo item manual (201 mặc định = status route cũ). */
  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createStudyPlanSchema)) body: CreateStudyPlanInput,
  ) {
    return this.studyPlan.createItem(user.id, body);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(patchStudyPlanSchema)) body: PatchStudyPlanInput,
  ) {
    return this.studyPlan.updateItem(user.id, id, body);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.studyPlan.deleteItem(user.id, id);
  }

  /** POST /study-plan/:id/skip — route cũ trả 200 (Nest POST mặc định 201 → ép lại). */
  @Post(':id/skip')
  @HttpCode(200)
  skip(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.studyPlan.skipItem(user.id, id);
  }
}
