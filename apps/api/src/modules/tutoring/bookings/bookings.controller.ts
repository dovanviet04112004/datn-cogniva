/**
 * /api/tutoring/{bookings,calendar/me,ical/:token} — port từ route Next
 * (apps/web/src/app/api/tutoring/**). KHÔNG port: bookings/:id PATCH,
 * reschedule, calendar (không /me) — 0 caller (chết).
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { checkLimit } from '@cogniva/server-core/rate-limit';

import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../../common/auth/session.types';
import {
  CANCEL_SCHEMA,
  REVIEW_SCHEMA,
  TutoringBookingsService,
} from './bookings.service';

@ApiTags('tutoring')
@Controller('tutoring')
export class TutoringBookingsController {
  constructor(private readonly bookings: TutoringBookingsService) {}

  /** GET /tutoring/bookings?role=student|tutor|all&upcoming=true — list ≤50. */
  @Get('bookings')
  list(
    @CurrentUser() user: AuthUser,
    @Query('role') role?: string,
    @Query('upcoming') upcoming?: string,
  ) {
    return this.bookings.listBookings(user.id, role ?? 'all', upcoming === 'true');
  }

  /**
   * POST /tutoring/bookings — student tạo booking (201).
   * Rate-limit Redis chạy TRƯỚC body parse (429 ưu tiên 400 như route cũ)
   * → body raw, service tự safeParse.
   */
  @Post('bookings')
  async create(
    @CurrentUser() user: AuthUser,
    @Body() raw: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const rl = await checkLimit(`booking:${user.id}`, 'default');
    if (!rl.allowed) {
      res.setHeader('Retry-After', String(rl.retryAfter ?? 60));
      throw new HttpException({ error: 'Quá nhiều booking — đợi vài phút' }, 429);
    }
    return this.bookings.createBooking(user.id, raw);
  }

  /** GET /tutoring/calendar/me?from&to — unified calendar (default +14d). */
  @Get('calendar/me')
  calendarMe(
    @CurrentUser() user: AuthUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.bookings.calendarMe(user.id, from, to);
  }

  /**
   * GET /tutoring/ical/:token — public feed .ics (auth bằng token trong path).
   * Bản cũ trả raw Response text (không JSON) → control express response tay.
   */
  @Public()
  @Get('ical/:token')
  async ical(@Param('token') token: string, @Res() res: Response) {
    const out = await this.bookings.buildIcalFeedForToken(token);
    if ('error' in out) {
      res.status(out.status).set('Content-Type', 'text/plain;charset=UTF-8').send(out.error);
      return;
    }
    res
      .status(200)
      .set({
        'Content-Type': 'text/calendar; charset=utf-8',
        'Cache-Control': 'private, max-age=300',
        'Content-Disposition': 'inline; filename="cogniva-tutoring.ics"',
      })
      .send(out.ics);
  }

  /** GET /tutoring/bookings/:id — detail + review + payment + role. */
  @Get('bookings/:id')
  detail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.bookings.getBooking(user.id, id);
  }

  /** POST /tutoring/bookings/:id/confirm — tutor confirm (route cũ 200). */
  @HttpCode(200)
  @Post('bookings/:id/confirm')
  confirm(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.bookings.confirmBooking(user.id, id);
  }

  /** POST /tutoring/bookings/:id/cancel — student/tutor huỷ (route cũ 200). */
  @HttpCode(200)
  @Post('bookings/:id/cancel')
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(CANCEL_SCHEMA)) body: { reason?: string },
  ) {
    return this.bookings.cancelBooking(user, id, body);
  }

  /** POST /tutoring/bookings/:id/complete — tutor mark COMPLETED (route cũ 200). */
  @HttpCode(200)
  @Post('bookings/:id/complete')
  complete(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.bookings.completeBooking(user.id, id);
  }

  /** POST /tutoring/bookings/:id/review — student review (201 như route cũ). */
  @Post('bookings/:id/review')
  review(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(REVIEW_SCHEMA)) body: { rating: number; comment?: string },
  ) {
    return this.bookings.reviewBooking(user.id, id, body);
  }
}
