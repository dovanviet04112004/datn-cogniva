/**
 * TutoringBookingsModule — Wave 6 MODULE TIỀN: bookings lifecycle (create →
 * confirm → complete/cancel → review), payment intent/capture STUB, payouts,
 * calendar/me + iCal feed public.
 *
 * PaymentsModule: PaymentProviderService (refund/intent — KHÔNG tự viết lại
 * logic ký). NotificationsModule: notify student/tutor fail-open.
 */
import { Module } from '@nestjs/common';

import { NotificationsModule } from '../../notifications/notifications.module';
import { PaymentsModule } from '../../payments/payments.module';
import { BookingHelpersService } from './booking-helpers.service';
import { TutoringBookingsController } from './bookings.controller';
import { TutoringBookingsService } from './bookings.service';
import { TutoringPaymentsController } from './payments.controller';

@Module({
  imports: [PaymentsModule, NotificationsModule],
  controllers: [TutoringBookingsController, TutoringPaymentsController],
  providers: [TutoringBookingsService, BookingHelpersService],
})
export class TutoringBookingsModule {}
