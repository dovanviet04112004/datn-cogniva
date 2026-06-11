import { createHmac } from 'node:crypto';

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  NotFoundException,
  Post,
  Query,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { Public } from '../../common/decorators/public.decorator';
import { PrismaService } from '../../infra/database/prisma.service';
import { PaymentProviderService } from '../payments/payment-provider.service';
import { LivekitWebhookService } from './livekit-webhook.service';

type MomoIpn = {
  partnerCode?: string;
  orderId?: string;
  requestId?: string;
  amount?: number;
  orderInfo?: string;
  orderType?: string;
  transId?: number;
  resultCode?: number;
  message?: string;
  payType?: string;
  responseTime?: number;
  extraData?: string;
  signature?: string;
};

function verifyMomoSignature(body: MomoIpn): boolean {
  const secret = process.env.MOMO_SECRET_KEY;
  const accessKey = process.env.MOMO_ACCESS_KEY;
  if (!secret || !accessKey || !body.signature) return false;

  const raw =
    `accessKey=${accessKey}` +
    `&amount=${body.amount}` +
    `&extraData=${body.extraData ?? ''}` +
    `&message=${body.message ?? ''}` +
    `&orderId=${body.orderId}` +
    `&orderInfo=${body.orderInfo ?? ''}` +
    `&orderType=${body.orderType ?? ''}` +
    `&partnerCode=${body.partnerCode}` +
    `&payType=${body.payType ?? ''}` +
    `&requestId=${body.requestId}` +
    `&responseTime=${body.responseTime}` +
    `&resultCode=${body.resultCode}` +
    `&transId=${body.transId}`;

  const expected = createHmac('sha256', secret).update(raw).digest('hex');
  return expected === body.signature;
}

function stringParams(input: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!input || typeof input !== 'object') return out;
  for (const [k, v] of Object.entries(input)) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

@ApiTags('webhooks')
@Controller('webhooks')
export class WebhooksController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentProvider: PaymentProviderService,
    private readonly livekit: LivekitWebhookService,
  ) {}

  @Public()
  @Get('vnpay')
  vnpayReturn(@Query() query: Record<string, unknown>) {
    return this.handleVnpay(stringParams(query));
  }

  @Public()
  @Post('vnpay')
  @HttpCode(200)
  vnpayIpn(@Body() body: unknown) {
    return this.handleVnpay(stringParams(body));
  }

  private async handleVnpay(params: Record<string, string>) {
    if (!process.env.VNPAY_HASH_SECRET) {
      throw new ServiceUnavailableException({
        error: 'VNPay chưa cấu hình — env VNPAY_HASH_SECRET thiếu',
      });
    }

    if (!this.paymentProvider.verifyVnpaySignature(params)) {
      throw new BadRequestException({ error: 'Invalid signature' });
    }

    const orderCode = params['vnp_TxnRef'];
    const respCode = params['vnp_ResponseCode'];
    if (!orderCode || !respCode) {
      throw new BadRequestException({ error: 'Missing required fields' });
    }

    const pay = await this.prisma.tutoring_payment.findUnique({
      where: { order_code: orderCode },
    });
    if (!pay) {
      throw new NotFoundException({ error: 'Payment not found' });
    }

    if (pay.status === 'CAPTURED' && respCode === '00') {
      return { ok: true, already: 'CAPTURED' };
    }

    const newStatus = respCode === '00' ? 'CAPTURED' : 'FAILED';
    await this.prisma.tutoring_payment.update({
      where: { id: pay.id },
      data: {
        status: newStatus,
        provider_ref: params['vnp_TransactionNo'] ?? null,
        captured_at: newStatus === 'CAPTURED' ? new Date() : null,
        raw_response: { ipn: params },
      },
    });

    return { ok: true, status: newStatus };
  }

  @Public()
  @Post('momo')
  @HttpCode(200)
  async momoIpn(@Req() req: RawBodyRequest<Request>) {
    if (!process.env.MOMO_SECRET_KEY) {
      throw new ServiceUnavailableException({
        error: 'MoMo chưa cấu hình — env MOMO_SECRET_KEY thiếu',
      });
    }

    let body: MomoIpn | null = null;
    try {
      const raw = req.rawBody?.toString();
      body = raw ? (JSON.parse(raw) as MomoIpn) : null;
    } catch {
      body = null;
    }
    if (!body) {
      throw new BadRequestException({ error: 'Invalid body' });
    }

    if (!verifyMomoSignature(body)) {
      throw new BadRequestException({ error: 'Invalid signature' });
    }

    if (!body.orderId || body.resultCode === undefined) {
      throw new BadRequestException({ error: 'Missing orderId / resultCode' });
    }

    const pay = await this.prisma.tutoring_payment.findUnique({
      where: { order_code: body.orderId },
    });
    if (!pay) {
      throw new NotFoundException({ error: 'Payment not found' });
    }

    if (pay.status === 'CAPTURED' && body.resultCode === 0) {
      return { ok: true, already: 'CAPTURED' };
    }

    const newStatus = body.resultCode === 0 ? 'CAPTURED' : 'FAILED';
    await this.prisma.tutoring_payment.update({
      where: { id: pay.id },
      data: {
        status: newStatus,
        provider_ref: body.transId ? String(body.transId) : null,
        captured_at: newStatus === 'CAPTURED' ? new Date() : null,
        raw_response: { ipn: body },
      },
    });

    return { ok: true, status: newStatus };
  }

  @Public()
  @Post('livekit')
  @HttpCode(200)
  async livekitWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('authorization') authHeader?: string,
  ) {
    return this.livekit.handle(req.rawBody?.toString() ?? '', authHeader);
  }
}
