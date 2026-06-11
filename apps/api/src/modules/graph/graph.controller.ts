import { Controller, Get, HttpCode, HttpException, Param, Post, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { checkLimit } from '@cogniva/server-core/rate-limit';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/auth/session.types';
import { GraphService } from './graph.service';

@ApiTags('graph')
@Controller('graph')
export class GraphController {
  constructor(private readonly graph: GraphService) {}

  @Get()
  getGraph(@CurrentUser() user: AuthUser, @Query('workspaceId') workspaceId?: string) {
    return this.graph.getGraphForUser(user.id, workspaceId ?? null);
  }

  @HttpCode(200)
  @Post('mine')
  async mine(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response) {
    const rl = await checkLimit(`graph-mine:${user.id}`, 'aiGenerate');
    if (!rl.allowed) {
      res.setHeader('Retry-After', String(rl.retryAfter ?? 60));
      throw new HttpException({ error: 'Đợi vài giây rồi thử lại' }, 429);
    }
    return this.graph.minePrerequisitesForUser(user.id);
  }

  @Get('concept/:id')
  conceptDetail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.graph.getConceptDetail(user.id, id);
  }
}
