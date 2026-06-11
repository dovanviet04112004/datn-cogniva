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
