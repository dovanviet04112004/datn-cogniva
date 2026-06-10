import { Module } from '@nestjs/common';

import { WorkspaceAiService } from './workspace-ai.service';
import { WorkspacesController } from './workspaces.controller';
import { WorkspacesService } from './workspaces.service';

/**
 * WorkspacesModule — CRUD + stats/atoms/manage/quick-quiz/conversations +
 * 2 output LLM (atom-guide/briefing) (GĐ3 → learning-service).
 * LlmService/CostGuardrailService inject thẳng từ AiModule (@Global).
 * GET :id/today KHÔNG port — route cũ 0 caller (đã thay bằng /study-plan/today).
 */
@Module({
  controllers: [WorkspacesController],
  providers: [WorkspacesService, WorkspaceAiService],
})
export class WorkspacesModule {}
