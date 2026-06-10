/**
 * /api/library/* — nhóm MONEY (payment stub qua wallet nội bộ), port từ
 * apps/web/src/app/api/library/{docs/[id]/purchase,subscribe-pro,cancel-pro}.
 * POST route cũ đều trả 200 → @HttpCode(200); thiếu tiền → 402 y route cũ.
 */
import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/auth/session.types';
import { LibraryMoneyService } from './library-money.service';

@ApiTags('library')
@Controller('library')
export class LibraryMoneyController {
  constructor(private readonly money: LibraryMoneyService) {}

  /** POST docs/:id/purchase — mua premium doc (idempotent, PRO ghi row 0đ). */
  @HttpCode(200)
  @Post('docs/:id/purchase')
  purchase(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.money.purchase(user.id, id);
  }

  /** POST subscribe-pro — 199k/tháng, stack proUntilAt nếu còn hạn. */
  @HttpCode(200)
  @Post('subscribe-pro')
  subscribePro(@CurrentUser() user: AuthUser, @Body() raw: unknown) {
    return this.money.subscribePro(user.id, raw);
  }

  /** POST cancel-pro — refund prorate phần chưa dùng + flip plan FREE. */
  @HttpCode(200)
  @Post('cancel-pro')
  cancelPro(@CurrentUser() user: AuthUser) {
    return this.money.cancelPro(user.id);
  }
}
