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
