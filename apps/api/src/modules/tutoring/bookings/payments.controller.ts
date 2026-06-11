import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../../common/auth/session.types';
import { INTENT_SCHEMA, TutoringBookingsService } from './bookings.service';

@ApiTags('tutoring')
@Controller('tutoring')
export class TutoringPaymentsController {
  constructor(private readonly bookings: TutoringBookingsService) {}

  @HttpCode(200)
  @Post('payments/intent')
  createIntent(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(INTENT_SCHEMA)) body: { bookingId: string },
  ) {
    return this.bookings.createIntent(user.id, body);
  }

  @HttpCode(200)
  @Post('payments/:id/capture')
  capture(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.bookings.capturePayment(user.id, id);
  }

  @Get('payouts')
  listPayouts(@CurrentUser() user: AuthUser) {
    return this.bookings.listPayouts(user.id);
  }

  @Post('payouts')
  requestPayout(@CurrentUser() user: AuthUser, @Body() raw: unknown) {
    return this.bookings.requestPayout(user.id, raw);
  }
}
