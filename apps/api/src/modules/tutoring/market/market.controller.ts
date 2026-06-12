import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import type { AuthUser } from '../../../common/auth/session.types';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import {
  COMPARE_SCHEMA,
  PACK_PURCHASE_SCHEMA,
  PROMO_REDEEM_SCHEMA,
  type CompareInput,
  type PackPurchaseInput,
  type PromoRedeemInput,
} from './dto/market.dto';
import { TutoringMarketService } from './market.service';
import { TutoringMatchingService } from './matching.service';

@ApiTags('tutoring')
@Controller('tutoring')
export class TutoringMarketController {
  constructor(
    private readonly market: TutoringMarketService,
    private readonly matching: TutoringMatchingService,
  ) {}

  @Public()
  @Get('classes')
  listClasses(
    @Query('subject') subject?: string,
    @Query('level') level?: string,
    @Query('from') from?: string,
  ) {
    return this.market.listClasses({ subject, level, from });
  }

  @Post('packs/:id/purchase')
  purchase(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(PACK_PURCHASE_SCHEMA)) body: PackPurchaseInput,
  ) {
    return this.market.purchasePack(user.id, id, body);
  }

  @HttpCode(200)
  @Post('promo/redeem')
  redeem(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(PROMO_REDEEM_SCHEMA)) body: PromoRedeemInput,
  ) {
    return this.market.redeemPromo(user.id, body);
  }

  @Get('favorites')
  favorites(@CurrentUser() user: AuthUser) {
    return this.market.listFavorites(user.id);
  }

  @Get('my-profile')
  myProfile(@CurrentUser() user: AuthUser) {
    return this.market.getMyProfile(user.id);
  }

  @Get('my-kyc')
  myKyc(@CurrentUser() user: AuthUser) {
    return this.market.getMyKyc(user.id);
  }

  @Get('mine-tab')
  mineTab(@CurrentUser() user: AuthUser) {
    return this.market.getMineTab(user.id);
  }

  @Get('requests')
  browseRequests(
    @Query('subject') subject?: string,
    @Query('level') level?: string,
    @Query('modality') modality?: string,
    @Query('urgency') urgency?: string,
    @Query('sort') sort?: string,
    @Query('page') page?: string,
    @Query('per') per?: string,
  ) {
    return this.market.browseRequests({ subject, level, modality, urgency, sort, page, per });
  }

  @Get('matches')
  matches(@Query('requestId') requestId?: string) {
    if (!requestId) {
      throw new BadRequestException({ error: 'requestId required' });
    }
    return this.matching.matches(requestId);
  }

  @Public()
  @HttpCode(200)
  @Post('compare')
  compare(@Body(new ZodValidationPipe(COMPARE_SCHEMA)) body: CompareInput) {
    return this.matching.compare(body);
  }
}
