import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../../common/auth/session.types';
import { LibraryMoneyService } from './money.service';

@ApiTags('library')
@Controller('library')
export class LibraryMoneyController {
  constructor(private readonly money: LibraryMoneyService) {}

  @Get('pro-status')
  proStatus(@CurrentUser() user: AuthUser) {
    return this.money.proStatus(user.id);
  }

  @HttpCode(200)
  @Post('docs/:id/purchase')
  purchase(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.money.purchase(user.id, id);
  }

  @HttpCode(200)
  @Post('subscribe-pro')
  subscribePro(@CurrentUser() user: AuthUser, @Body() raw: unknown) {
    return this.money.subscribePro(user.id, raw);
  }

  @HttpCode(200)
  @Post('cancel-pro')
  cancelPro(@CurrentUser() user: AuthUser) {
    return this.money.cancelPro(user.id);
  }
}
