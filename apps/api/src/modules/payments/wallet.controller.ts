/** /api/wallet — balance + ledger + topup, port từ route Next (Wave 6). */
import { Body, Controller, Get, HttpCode, NotImplementedException, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/auth/session.types';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../infra/database/prisma.service';
import { WalletService } from './wallet.service';

const TOPUP_SCHEMA = z.object({
  amountVnd: z.number().int().min(10000).max(50_000_000),
  provider: z.enum(['VNPAY', 'MOMO', 'STUB']).optional(),
});

@ApiTags('wallet')
@Controller('wallet')
export class WalletController {
  constructor(
    private readonly wallet: WalletService,
    private readonly prisma: PrismaService,
  ) {}

  /** Balance + 10 txn gần nhất + auto-topup config. */
  @Get()
  async getWallet(@CurrentUser() user: AuthUser) {
    const wallet = await this.wallet.getWallet(user.id);
    const recent = await this.prisma.user_wallet_txn.findMany({
      where: { user_id: user.id },
      orderBy: { created_at: 'desc' },
      take: 10,
    });
    return {
      wallet,
      recentTxn: recent.map((t) => ({
        id: t.id,
        userId: t.user_id,
        type: t.type,
        amountVnd: t.amount_vnd,
        balanceAfterVnd: t.balance_after_vnd,
        relatedId: t.related_id,
        relatedType: t.related_type,
        description: t.description,
        createdAt: t.created_at,
      })),
    };
  }

  /** STUB auto-credit ngay (dev); VNPay/MoMo topup intent chưa wire (501 như bản cũ). */
  @Post('topup')
  @HttpCode(200)
  async topup(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(TOPUP_SCHEMA)) body: z.infer<typeof TOPUP_SCHEMA>,
  ) {
    const provider = body.provider ?? process.env.PAYMENT_PROVIDER ?? 'STUB';

    if (provider === 'STUB') {
      const { txnId, cashback } = await this.wallet.topupWallet({
        userId: user.id,
        amountVnd: body.amountVnd,
        description: `Dev STUB nạp ${body.amountVnd.toLocaleString('vi-VN')}đ`,
      });
      return { provider: 'STUB', txnId, cashback, autoCredited: true };
    }

    throw new NotImplementedException({
      error:
        'Provider VNPAY/MoMo cho wallet topup chưa wire. Set PAYMENT_PROVIDER=STUB ở .env.local để test dev.',
    });
  }
}
