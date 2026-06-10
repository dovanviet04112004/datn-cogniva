/**
 * /api/workspaces/* — port từ route Next (apps/web/src/app/api/workspaces/**).
 * Tất cả route đều cần session (guard mặc định lo 401 {error:'Unauthorized'}).
 */
import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/auth/session.types';
import { WorkspaceAiService } from './workspace-ai.service';
import { WorkspacesService, type AtomSort } from './workspaces.service';
import {
  createWorkspaceSchema,
  updateWorkspaceSchema,
  type CreateWorkspaceInput,
  type UpdateWorkspaceInput,
} from './dto/workspaces.dto';

@ApiTags('workspaces')
@Controller('workspaces')
export class WorkspacesController {
  constructor(
    private readonly workspaces: WorkspacesService,
    private readonly ai: WorkspaceAiService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.workspaces.listWorkspaces(user.id);
  }

  /** POST /workspaces — 201 mặc định của Nest = status route cũ. */
  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createWorkspaceSchema)) body: CreateWorkspaceInput,
  ) {
    return this.workspaces.createWorkspace(user.id, body);
  }

  @Get(':id')
  detail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.workspaces.getWorkspace(user.id, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateWorkspaceSchema)) body: UpdateWorkspaceInput,
  ) {
    return this.workspaces.updateWorkspace(user.id, id, body);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.workspaces.deleteWorkspace(user.id, id);
  }

  /** GET /workspaces/:id/atom-guide?regenerate=1 — LLM study guide (cache 24h). */
  @Get(':id/atom-guide')
  atomGuide(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('regenerate') regenerate?: string,
  ) {
    return this.ai.atomGuide(user, id, regenerate === '1');
  }

  /** GET /workspaces/:id/atoms?sort=mastery&limit=100 — parse y route cũ (cap 200). */
  @Get(':id/atoms')
  atoms(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('sort') sortRaw?: string,
    @Query('limit') limitRaw?: string,
  ) {
    const sort = (sortRaw ?? 'mastery') as AtomSort;
    const limit = Math.min(200, parseInt(limitRaw ?? '100', 10));
    return this.workspaces.listAtoms(user.id, id, sort, limit);
  }

  /** GET /workspaces/:id/briefing?regenerate=1 — LLM tóm tắt 200-300 từ (cache 24h). */
  @Get(':id/briefing')
  briefing(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('regenerate') regenerate?: string,
  ) {
    return this.ai.briefing(user, id, regenerate === '1');
  }

  @Get(':id/conversations')
  conversations(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.workspaces.listConversations(user.id, id);
  }

  @Get(':id/manage')
  manage(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.workspaces.manage(user.id, id);
  }

  @Get(':id/quick-quiz')
  quickQuiz(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.workspaces.quickQuiz(user.id, id);
  }

  @Get(':id/stats')
  stats(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.workspaces.getStats(user.id, id);
  }
}
