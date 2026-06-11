import { Module } from '@nestjs/common';

import { WorkspaceAiService } from './workspace-ai.service';
import { WorkspacesController } from './workspaces.controller';
import { WorkspacesService } from './workspaces.service';

@Module({
  controllers: [WorkspacesController],
  providers: [WorkspacesService, WorkspaceAiService],
})
export class WorkspacesModule {}
