import { Module } from '@nestjs/common';

import { AccountController } from './account.controller';
import { AccountService } from './account.service';

/**
 * AccountModule — GDPR delete/export + AI usage + Expo push token (mount
 * 'account'). PrismaService/CostGuardrailService inject từ module @Global.
 */
@Module({
  controllers: [AccountController],
  providers: [AccountService],
})
export class AccountModule {}
