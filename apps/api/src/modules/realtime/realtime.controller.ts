import { Body, Controller, ForbiddenException, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/auth/session.types';
import { RealtimeService } from './realtime.service';

@ApiTags('realtime')
@Controller('realtime')
export class RealtimeController {
  constructor(private readonly realtime: RealtimeService) {}

  @HttpCode(200)
  @Post('auth')
  async auth(@CurrentUser() user: AuthUser, @Body() body: { channel?: string } | undefined) {
    const channel = body?.channel;

    if (channel) {
      const ok = await this.realtime.authorize(channel, user.id);
      if (!ok) throw new ForbiddenException({ error: 'Forbidden' });
    }

    return { user: { id: user.id, name: user.name, image: user.image } };
  }
}
