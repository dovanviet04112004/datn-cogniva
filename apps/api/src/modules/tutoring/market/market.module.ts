/**
 * TutoringMarketModule — Wave 6, marketplace gia sư (10 route):
 * requests create/detail/patch + apply + applications accept/reject,
 * classes browse, packs purchase, promo redeem, favorites, AI matches, compare.
 *
 * Tiền (chargeWallet/applyPromoCredit) qua PaymentsModule. Prisma/Embedding/
 * TokenService/OptionalAuth là @Global → không cần imports.
 */
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
