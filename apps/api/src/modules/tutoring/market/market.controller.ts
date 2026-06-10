/**
 * /api/tutoring/{classes,packs,promo,favorites,matches,compare} — market chung.
 *
 * Public như route cũ: classes GET (browse), compare POST (KHÔNG auth check
 * nào ở bản cũ). packs/:id/purchase được gọi từ <form method=POST> HTML —
 * vẫn trả JSON 201 y bản cũ (không redirect).
 *
 * KHÔNG port: classes POST + classes/:id/enroll (chết), packs GET/POST,
 * saved-searches, reviews/:id/helpful, blocked-time.
 */
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
} from './market.dto';
import { TutoringMarketService } from './market.service';
import { TutoringMatchingService } from './matching.service';

@ApiTags('tutoring')
@Controller('tutoring')
export class TutoringMarketController {
  constructor(
    private readonly market: TutoringMarketService,
    private readonly matching: TutoringMatchingService,
  ) {}

  /** GET classes — browse class OPEN ?subject&level&from. */
  @Public()
  @Get('classes')
  listClasses(
    @Query('subject') subject?: string,
    @Query('level') level?: string,
    @Query('from') from?: string,
  ) {
    return this.market.listClasses({ subject, level, from });
  }

  /** POST packs/:id/purchase — charge ví, 402 nếu thiếu tiền, 201 + purchase. */
  @Post('packs/:id/purchase')
  purchase(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(PACK_PURCHASE_SCHEMA)) body: PackPurchaseInput,
  ) {
    return this.market.purchasePack(user.id, id, body);
  }

  /** POST promo/redeem — validate code rồi apply theo type. */
  @HttpCode(200)
  @Post('promo/redeem')
  redeem(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(PROMO_REDEEM_SCHEMA)) body: PromoRedeemInput,
  ) {
    return this.market.redeemPromo(user.id, body);
  }

  /** GET favorites — list tutor đã favorite. */
  @Get('favorites')
  favorites(@CurrentUser() user: AuthUser) {
    return this.market.listFavorites(user.id);
  }

  /** GET matches?requestId= — AI match top 5 (lazy embedding); auth qua guard global. */
  @Get('matches')
  matches(@Query('requestId') requestId?: string) {
    if (!requestId) {
      throw new BadRequestException({ error: 'requestId required' });
    }
    return this.matching.matches(requestId);
  }

  /** POST compare — bulk so sánh 2-4 tutor (public). */
  @Public()
  @HttpCode(200)
  @Post('compare')
  compare(@Body(new ZodValidationPipe(COMPARE_SCHEMA)) body: CompareInput) {
    return this.matching.compare(body);
  }
}
