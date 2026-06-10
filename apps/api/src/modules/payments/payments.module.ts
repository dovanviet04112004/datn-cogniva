/**
 * PaymentsModule — hạ tầng tiền dùng chung (Wave 6): WalletService (ví VND
 * đầy đủ, thay LibraryWalletService SUBSET) + PaymentProviderService
 * (STUB/VNPay/MoMo) + 2 route /api/wallet. Tutoring/Webhooks/Library import
 * module này thay vì tự provide.
 */
import { Module } from '@nestjs/common';

import { PaymentProviderService } from './payment-provider.service';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';

@Module({
  controllers: [WalletController],
  providers: [WalletService, PaymentProviderService],
  exports: [WalletService, PaymentProviderService],
})
export class PaymentsModule {}
