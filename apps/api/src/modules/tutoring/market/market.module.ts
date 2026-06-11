import { Module } from '@nestjs/common';

import { PaymentsModule } from '../../payments/payments.module';
import { TutoringMarketController } from './market.controller';
import { TutoringMarketService } from './market.service';
import { TutoringMatchingService } from './matching.service';
import { TutoringRequestsController } from './requests.controller';
import { TutoringRequestsService } from './requests.service';

@Module({
  imports: [PaymentsModule],
  controllers: [TutoringRequestsController, TutoringMarketController],
  providers: [TutoringRequestsService, TutoringMarketService, TutoringMatchingService],
})
export class TutoringMarketModule {}
