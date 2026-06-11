import { createHmac } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';

export type PaymentProviderName = 'STUB' | 'VNPAY' | 'MOMO';

export type CreateIntentArgs = {
  orderCode: string;
  amountVnd: number;
  description: string;
  returnUrl: string;
  clientIp?: string;
};

export type CreateIntentResult = {
  paymentUrl: string;
  rawRequest: Record<string, unknown>;
  resolvedProvider: PaymentProviderName;
};

export type RefundArgs = {
  provider: PaymentProviderName;
  orderCode: string;
  providerRef: string | null;
  amountVnd: number;
  reason: string;
  initiatedBy: string;
};

export type RefundResult = {
  ok: boolean;
  message: string;
  rawResponse: Record<string, unknown> | null;
};

function formatVnpayDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

@Injectable()
export class PaymentProviderService {
  private readonly logger = new Logger(PaymentProviderService.name);

  resolveProvider(): PaymentProviderName {
    const raw = (process.env.PAYMENT_PROVIDER ?? 'STUB').toUpperCase();
    if (raw === 'VNPAY' || raw === 'MOMO') return raw;
    return 'STUB';
  }

  private isVnpayConfigured(): boolean {
    return Boolean(
      process.env.VNPAY_TMN_CODE && process.env.VNPAY_HASH_SECRET && process.env.VNPAY_RETURN_URL,
    );
  }

  private isMomoConfigured(): boolean {
    return Boolean(
      process.env.MOMO_PARTNER_CODE &&
      process.env.MOMO_ACCESS_KEY &&
      process.env.MOMO_SECRET_KEY &&
      process.env.MOMO_RETURN_URL,
    );
  }

  async createPaymentIntent(args: CreateIntentArgs): Promise<CreateIntentResult> {
    const requested = this.resolveProvider();

    if (requested === 'VNPAY' && this.isVnpayConfigured()) {
      const { url, request } = this.buildVnpayUrl(args);
      return { paymentUrl: url, rawRequest: request, resolvedProvider: 'VNPAY' };
    }
    if (requested === 'VNPAY') {
      this.logger.warn(
        'VNPAY env chưa đủ (VNPAY_TMN_CODE / VNPAY_HASH_SECRET / VNPAY_RETURN_URL) — fallback STUB.',
      );
    }

    if (requested === 'MOMO' && this.isMomoConfigured()) {
      try {
        const { url, request } = await this.buildMomoIntent(args);
        return { paymentUrl: url, rawRequest: request, resolvedProvider: 'MOMO' };
      } catch (err) {
        this.logger.warn(`MOMO create failed → fallback STUB: ${(err as Error).message}`);
      }
    }
    if (requested === 'MOMO' && !this.isMomoConfigured()) {
      this.logger.warn('MOMO env chưa đủ — fallback STUB.');
    }

    const stubUrl = `${args.returnUrl}?orderCode=${encodeURIComponent(args.orderCode)}&stub=1`;
    return {
      paymentUrl: stubUrl,
      rawRequest: { mode: 'stub', orderCode: args.orderCode, amount: args.amountVnd },
      resolvedProvider: 'STUB',
    };
  }

  private buildVnpayUrl(args: CreateIntentArgs): {
    url: string;
    request: Record<string, unknown>;
  } {
    const SANDBOX_URL =
      process.env.VNPAY_PAY_URL ?? 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html';

    const params: Record<string, string> = {
      vnp_Version: '2.1.0',
      vnp_Command: 'pay',
      vnp_TmnCode: process.env.VNPAY_TMN_CODE!,
      vnp_Amount: String(args.amountVnd * 100),
      vnp_CurrCode: 'VND',
      vnp_TxnRef: args.orderCode,
      vnp_OrderInfo: args.description,
      vnp_OrderType: 'other',
      vnp_Locale: 'vn',
      vnp_ReturnUrl: process.env.VNPAY_RETURN_URL ?? args.returnUrl,
      vnp_IpAddr: args.clientIp ?? '127.0.0.1',
      vnp_CreateDate: formatVnpayDate(new Date()),
    };

    const sortedKeys = Object.keys(params).sort();
    const queryString = sortedKeys
      .map((k) => `${k}=${encodeURIComponent(params[k]!).replace(/%20/g, '+')}`)
      .join('&');
    const signature = createHmac('sha512', process.env.VNPAY_HASH_SECRET!)
      .update(queryString)
      .digest('hex');

    return { url: `${SANDBOX_URL}?${queryString}&vnp_SecureHash=${signature}`, request: params };
  }

  private async buildMomoIntent(args: CreateIntentArgs): Promise<{
    url: string;
    request: Record<string, unknown>;
  }> {
    const endpoint =
      process.env.MOMO_CREATE_URL ?? 'https://test-payment.momo.vn/v2/gateway/api/create';

    const partnerCode = process.env.MOMO_PARTNER_CODE!;
    const accessKey = process.env.MOMO_ACCESS_KEY!;
    const secretKey = process.env.MOMO_SECRET_KEY!;

    const requestId = `${args.orderCode}-${Date.now()}`;
    const orderId = args.orderCode;
    const requestType = 'captureWallet';
    const extraData = '';
    const ipnUrl = process.env.MOMO_IPN_URL ?? '';
    const redirectUrl = process.env.MOMO_RETURN_URL ?? args.returnUrl;

    const rawSignature =
      `accessKey=${accessKey}` +
      `&amount=${args.amountVnd}` +
      `&extraData=${extraData}` +
      `&ipnUrl=${ipnUrl}` +
      `&orderId=${orderId}` +
      `&orderInfo=${args.description}` +
      `&partnerCode=${partnerCode}` +
      `&redirectUrl=${redirectUrl}` +
      `&requestId=${requestId}` +
      `&requestType=${requestType}`;
    const signature = createHmac('sha256', secretKey).update(rawSignature).digest('hex');

    const body = {
      partnerCode,
      partnerName: 'Cogniva',
      storeId: 'CognivaStore',
      requestId,
      amount: args.amountVnd,
      orderId,
      orderInfo: args.description,
      redirectUrl,
      ipnUrl,
      lang: 'vi',
      extraData,
      requestType,
      signature,
    };

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`[momo] create payment failed ${res.status}: ${await res.text()}`);
    }
    const data = (await res.json()) as { payUrl?: string; resultCode?: number; message?: string };
    if (data.resultCode !== 0 || !data.payUrl) {
      throw new Error(`[momo] create payment error: ${data.message ?? 'unknown'}`);
    }
    return { url: data.payUrl, request: body };
  }

  async refundPayment(args: RefundArgs): Promise<RefundResult> {
    if (args.provider === 'STUB') {
      return { ok: true, message: 'STUB refund — local flag', rawResponse: null };
    }

    if (args.provider === 'VNPAY') {
      if (!this.isVnpayConfigured() || !process.env.VNPAY_REFUND_URL) {
        return {
          ok: false,
          message: 'VNPay refund cần VNPAY_TMN_CODE/HASH_SECRET/REFUND_URL',
          rawResponse: null,
        };
      }
      if (!args.providerRef) {
        return { ok: false, message: 'Thiếu vnp_TransactionNo gốc', rawResponse: null };
      }

      const now = new Date();
      const requestId = `RF-${args.orderCode}-${Date.now()}`;
      const createDate = formatVnpayDate(now);

      const fields = {
        vnp_RequestId: requestId,
        vnp_Version: '2.1.0',
        vnp_Command: 'refund',
        vnp_TmnCode: process.env.VNPAY_TMN_CODE!,
        vnp_TransactionType: '02',
        vnp_TxnRef: args.orderCode,
        vnp_Amount: String(args.amountVnd * 100),
        vnp_TransactionNo: args.providerRef,
        vnp_TransactionDate: createDate,
        vnp_CreateBy: args.initiatedBy,
        vnp_CreateDate: createDate,
        vnp_IpAddr: '127.0.0.1',
        vnp_OrderInfo: args.reason,
      };
      const signSource = Object.values(fields).join('|');
      const signature = createHmac('sha512', process.env.VNPAY_HASH_SECRET!)
        .update(signSource)
        .digest('hex');

      try {
        const res = await fetch(process.env.VNPAY_REFUND_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...fields, vnp_SecureHash: signature }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          vnp_ResponseCode?: string;
          vnp_Message?: string;
        };
        const ok = data.vnp_ResponseCode === '00';
        return {
          ok,
          message: data.vnp_Message ?? (ok ? 'Refund OK' : 'Refund failed'),
          rawResponse: data as Record<string, unknown>,
        };
      } catch (err) {
        return {
          ok: false,
          message: `VNPay refund call failed: ${(err as Error).message}`,
          rawResponse: null,
        };
      }
    }

    if (args.provider === 'MOMO') {
      if (!this.isMomoConfigured() || !process.env.MOMO_REFUND_URL) {
        return {
          ok: false,
          message: 'MoMo refund cần MOMO_PARTNER_CODE/ACCESS_KEY/SECRET_KEY/REFUND_URL',
          rawResponse: null,
        };
      }
      if (!args.providerRef) {
        return { ok: false, message: 'Thiếu MoMo transId gốc', rawResponse: null };
      }

      const partnerCode = process.env.MOMO_PARTNER_CODE!;
      const accessKey = process.env.MOMO_ACCESS_KEY!;
      const secretKey = process.env.MOMO_SECRET_KEY!;
      const requestId = `RF-${args.orderCode}-${Date.now()}`;
      const orderId = `RF-${args.orderCode}`;

      const rawSignature =
        `accessKey=${accessKey}` +
        `&amount=${args.amountVnd}` +
        `&description=${args.reason}` +
        `&orderId=${orderId}` +
        `&partnerCode=${partnerCode}` +
        `&requestId=${requestId}` +
        `&transId=${args.providerRef}`;
      const signature = createHmac('sha256', secretKey).update(rawSignature).digest('hex');

      try {
        const res = await fetch(process.env.MOMO_REFUND_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            partnerCode,
            orderId,
            requestId,
            amount: args.amountVnd,
            transId: Number(args.providerRef),
            lang: 'vi',
            description: args.reason,
            signature,
          }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          resultCode?: number;
          message?: string;
        };
        const ok = data.resultCode === 0;
        return {
          ok,
          message: data.message ?? (ok ? 'Refund OK' : 'Refund failed'),
          rawResponse: data as Record<string, unknown>,
        };
      } catch (err) {
        return {
          ok: false,
          message: `MoMo refund call failed: ${(err as Error).message}`,
          rawResponse: null,
        };
      }
    }

    return {
      ok: false,
      message: `Provider ${args.provider} không hỗ trợ refund`,
      rawResponse: null,
    };
  }

  verifyVnpaySignature(params: Record<string, string>): boolean {
    const secret = process.env.VNPAY_HASH_SECRET;
    if (!secret) return false;

    const signature = params['vnp_SecureHash'];
    if (!signature) return false;

    const filtered: Record<string, string> = {};
    for (const [k, v] of Object.entries(params)) {
      if (k === 'vnp_SecureHash' || k === 'vnp_SecureHashType') continue;
      filtered[k] = v;
    }
    const sortedKeys = Object.keys(filtered).sort();
    const queryString = sortedKeys
      .map((k) => `${k}=${encodeURIComponent(filtered[k]!).replace(/%20/g, '+')}`)
      .join('&');
    const expected = createHmac('sha512', secret).update(queryString).digest('hex');
    return expected.toLowerCase() === signature.toLowerCase();
  }
}
