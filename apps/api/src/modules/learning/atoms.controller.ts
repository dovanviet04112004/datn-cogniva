/** /api/atoms/:id + /api/atoms/:id/items — port từ route Next (atom-centric). */
import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/auth/session.types';
import { AtomsService } from './atoms.service';

@ApiTags('atoms')
@Controller('atoms')
export class AtomsController {
  constructor(private readonly atoms: AtomsService) {}

  @Get(':id')
  async atomView(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const atom = await this.atoms.getAtomView(user.id, id);
    if (!atom) throw new NotFoundException({ error: 'Not found' });
    return { atom };
  }

  @Get(':id/items')
  async atomItems(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('workspaceId') workspaceId?: string,
  ) {
    const items = await this.atoms.getAtomItems(user.id, id, workspaceId ?? null);
    if (!items) throw new NotFoundException({ error: 'Not found' });
    return items;
  }
}
