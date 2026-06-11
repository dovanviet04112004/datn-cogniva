/**
 * /api/admin/tutoring/* — port từ apps/web/src/app/api/admin/tutoring/**.
 * Refund SUPER_ADMIN only (động tới tiền); cancel/hide/restore SUPER_ADMIN/ADMIN.
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import {
  AdminCtx,
  AdminGuard,
  AdminRoles,
  type AdminContext,
} from '../../../common/admin/admin.guard';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { AdminTutoringService } from './admin-tutoring.service';
import {
  adminReasonSchema,
  refundSchema,
  type AdminReasonInput,
  type RefundInput,
} from './dto/admin-domain.dto';

@ApiTags('admin')
@UseGuards(AdminGuard)
@Controller('admin')
export class AdminTutoringController {
  constructor(private readonly tutoring: AdminTutoringService) {}

  /** GET /admin/tutoring/bookings — list cross-marketplace, cursor startAt. */
  @Get('tutoring/bookings')
  listBookings(
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.tutoring.listBookings({ q, status, cursor, limit });
  }

  /** GET /admin/tutoring/bookings/:id — detail + payment + review. */
  @Get('tutoring/bookings/:id')
  bookingDetail(@Param('id') id: string) {
    return this.tutoring.getBookingDetail(id);
  }

  /** POST /admin/tutoring/bookings/:id/cancel — force cancel + notify. */
  @Post('tutoring/bookings/:id/cancel')
  @AdminRoles('SUPER_ADMIN', 'ADMIN')
  @HttpCode(200)
  cancelBooking(
    @AdminCtx() ctx: AdminContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(adminReasonSchema)) body: AdminReasonInput,
  ) {
    return this.tutoring.cancelBooking(ctx, id, body.reason);
  }

  /** POST /admin/tutoring/bookings/:id/refund — STUB, SUPER_ADMIN only. */
  @Post('tutoring/bookings/:id/refund')
  @AdminRoles('SUPER_ADMIN')
  @HttpCode(200)
  refundBooking(
    @AdminCtx() ctx: AdminContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(refundSchema)) body: RefundInput,
  ) {
    return this.tutoring.refundBooking(ctx, id, body);
  }

  /** GET /admin/tutoring/reviews — list + hiddenCount badge. */
  @Get('tutoring/reviews')
  listReviews(
    @Query('visibility') visibility?: string,
    @Query('rating') rating?: string,
    @Query('q') q?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.tutoring.listReviews({ visibility, rating, q, cursor, limit });
  }

  /** POST /admin/tutoring/reviews/:id/hide — ẩn khỏi tutor profile. */
  @Post('tutoring/reviews/:id/hide')
  @AdminRoles('SUPER_ADMIN', 'ADMIN')
  @HttpCode(200)
  hideReview(
    @AdminCtx() ctx: AdminContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(adminReasonSchema)) body: AdminReasonInput,
  ) {
    return this.tutoring.hideReview(ctx, id, body.reason);
  }

  /** POST /admin/tutoring/reviews/:id/restore — unhide. */
  @Post('tutoring/reviews/:id/restore')
  @AdminRoles('SUPER_ADMIN', 'ADMIN')
  @HttpCode(200)
  restoreReview(
    @AdminCtx() ctx: AdminContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(adminReasonSchema)) body: AdminReasonInput,
  ) {
    return this.tutoring.restoreReview(ctx, id, body.reason);
  }
}
