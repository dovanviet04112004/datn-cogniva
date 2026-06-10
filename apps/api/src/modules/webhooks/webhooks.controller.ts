/**
 * /api/webhooks — receiver PUBLIC cho provider ngoài, port từ
 * apps/web/src/app/api/webhooks/** (status + body từng nhánh GIỮ NGUYÊN):
 *   - GET+POST /vnpay : ReturnUrl (browser redirect) + IPN — cùng logic handle.
 *   - POST /momo      : IPN MoMo, verify HMAC-SHA256 inline theo spec.
 *   - POST /livekit   : LiveKit server events (verify JWT + raw body sha256).
 *
 * VNPay/MoMo CHỈ flip status tutoring_payment (booking flow) — KHÔNG update
 * booking, KHÔNG credit ví (wallet topup qua provider chưa wire, y bản cũ).
 */
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

/**
 * Verify IPN MoMo — HMAC-SHA256 inline (KHÔNG ở PaymentProviderService, y bản
 * cũ). Raw string theo THỨ TỰ FIELD CỐ ĐỊNH của spec; field thiếu interpolate
 * thành 'undefined' — quirk giữ nguyên để khớp chữ ký từng byte.
 */
function verifyMomoSignature(body: MomoIpn): boolean {
  const secret = process.env.MOMO_SECRET_KEY;
  const accessKey = process.env.MOMO_ACCESS_KEY;
  if (!secret || !accessKey || !body.signature) return false;

  const raw
    = `accessKey=${accessKey}`
    + `&amount=${body.amount}`
    + `&extraData=${body.extraData ?? ''}`
    + `&message=${body.message ?? ''}`
    + `&orderId=${body.orderId}`
    + `&orderInfo=${body.orderInfo ?? ''}`
    + `&orderType=${body.orderType ?? ''}`
    + `&partnerCode=${body.partnerCode}`
    + `&payType=${body.payType ?? ''}`
    + `&requestId=${body.requestId}`
    + `&responseTime=${body.responseTime}`
    + `&resultCode=${body.resultCode}`
    + `&transId=${body.transId}`;

  const expected = createHmac('sha256', secret).update(raw).digest('hex');
  return expected === body.signature;
}

/** Route cũ chỉ nhận giá trị string từ query/JSON/form — giữ luật lọc đó. */
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

  /** ReturnUrl GET (browser redirect) — VNPay cũng có thể gọi IPN qua GET. */
  @Public()
  @Get('vnpay')
  vnpayReturn(@Query() query: Record<string, unknown>) {
    return this.handleVnpay(stringParams(query));
  }

  /** IPN POST — body JSON hoặc x-www-form-urlencoded (main.ts bật cả 2 parser). */
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

    // Idempotent
    if (pay.status === 'CAPTURED' && respCode === '00') {
      return { ok: true, already: 'CAPTURED' };
    }

    // ResponseCode '00' = success; mọi khác = fail
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

    // Parse từ rawBody thay vì @Body() để giữ nhánh 400 'Invalid body' của bản
    // cũ (body trống / không phải JSON — @Body() sẽ trả {} không phân biệt được).
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

    // Idempotent
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

    // MoMo spec expect 204 No Content — bản cũ trả 200 JSON, giữ nguyên.
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
