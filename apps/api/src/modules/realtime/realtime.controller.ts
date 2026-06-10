/**
 * POST /api/realtime/auth — endpoint NỘI BỘ cho Socket.IO gateway (apps/realtime).
 * Port từ apps/web/src/app/api/realtime/auth/route.ts.
 *
 * Gateway gọi (server-to-server, forward credential của client) ở 2 thời điểm:
 *   1. CONNECT  : body `{}` (không channel) → chỉ verify session → trả `{ user }` (whoami).
 *   2. SUBSCRIBE: body `{ channel }` → verify session + authorize membership channel →
 *      200 `{ user }` nếu được, 401/403 nếu không.
 *
 * 401 do AuthGuard toàn cục lo (cookie web / Bearer mobile — dual-accept JWT mới
 * + session Better Auth cũ). name/image lấy từ claims access token (token cũ
 * chưa có claims → null) hoặc từ Redis/DB ở legacy path.
 */
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

    // SUBSCRIBE: có channel → phải authorize. CONNECT: không channel → bỏ qua, chỉ whoami.
    if (channel) {
      const ok = await this.realtime.authorize(channel, user.id);
      if (!ok) throw new ForbiddenException({ error: 'Forbidden' });
    }

    return { user: { id: user.id, name: user.name, image: user.image } };
  }
}
