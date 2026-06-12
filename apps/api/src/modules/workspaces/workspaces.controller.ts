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

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createWorkspaceSchema)) body: CreateWorkspaceInput,
  ) {
    return this.workspaces.createWorkspace(user.id, body);
  }

  @Get('default')
  defaultWorkspace(@CurrentUser() user: AuthUser) {
    return this.workspaces.getOrCreateDefault(user.id);
  }

  @Get('overview')
  overview(@CurrentUser() user: AuthUser) {
    return this.workspaces.overview(user.id);
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

  @Get(':id/atom-guide')
  atomGuide(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('regenerate') regenerate?: string,
  ) {
    return this.ai.atomGuide(user, id, regenerate === '1');
  }

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
