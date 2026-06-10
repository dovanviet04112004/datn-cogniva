/**
 * Payment provider abstraction — switch giữa STUB / VNPAY / MOMO.
 *
 * Mục tiêu: route handler không quan tâm provider nào — chỉ gọi
 * `createPaymentIntent()` và xử lý response. Khi anh nạp credentials provider
 * thực, chỉ cần đổi env `PAYMENT_PROVIDER` từ STUB → VNPAY/MOMO.
 *
 * Hiện trạng:
 *   - STUB   : trả về URL local có ?stub=1, FE auto call /capture endpoint.
 *              `refund()` chỉ flag REFUNDED local.
 *   - VNPAY  : build sign URL theo VNPay spec (TmnCode, vnp_HashSecret).
 *              Webhook /api/webhooks/vnpay parse + verify HMAC.
 *              Refund qua POST `VNPAY_REFUND_URL` (merchant_webapi).
 *              Env: VNPAY_TMN_CODE, VNPAY_HASH_SECRET, VNPAY_RETURN_URL,
 *                   VNPAY_PAY_URL, VNPAY_REFUND_URL.
 *   - MOMO   : POST tới `MOMO_CREATE_URL` với HMAC SHA256 raw signature.
 *              Webhook /api/webhooks/momo verify signature + update status.
 *              Refund qua POST `MOMO_REFUND_URL`.
 *              Env: MOMO_PARTNER_CODE, MOMO_ACCESS_KEY, MOMO_SECRET_KEY,
 *                   MOMO_CREATE_URL, MOMO_REFUND_URL, MOMO_RETURN_URL,
 *                   MOMO_IPN_URL.
 *
 * Khi env provider thiếu → fallback STUB + log warning.
 */
import { createHmac } from 'node:crypto';

export type PaymentProviderName = 'STUB' | 'VNPAY' | 'MOMO';

export type CreateIntentArgs = {
  orderCode: string;
  amountVnd: number;
  description: string;
  /** URL FE redirect về sau khi user paid (success hoặc fail). */
  returnUrl: string;
  /** Optional clientIp — VNPay yêu cầu cho fraud check. */
  clientIp?: string;
};

export type CreateIntentResult = {
  /** URL FE redirect user tới để thanh toán. */
  paymentUrl: string;
  /** Provider trả về để lưu — debug. */
  rawRequest: Record<string, unknown>;
  /** Provider thực sự dùng (sau fallback). */
  resolvedProvider: PaymentProviderName;
};

function resolveProvider(): PaymentProviderName {
  const raw = (process.env.PAYMENT_PROVIDER ?? 'STUB').toUpperCase();
  if (raw === 'VNPAY' || raw === 'MOMO') return raw;
  return 'STUB';
}

function isVnpayConfigured(): boolean {
  return Boolean(
    process.env.VNPAY_TMN_CODE
    && process.env.VNPAY_HASH_SECRET
    && process.env.VNPAY_RETURN_URL,
  );
}

function isMomoConfigured(): boolean {
  return Boolean(
    process.env.MOMO_PARTNER_CODE
    && process.env.MOMO_ACCESS_KEY
    && process.env.MOMO_SECRET_KEY
    && process.env.MOMO_RETURN_URL,
  );
}

function buildVnpayUrl(args: CreateIntentArgs): { url: string; request: Record<string, unknown> } {
  // VNPay sandbox URL — ref: https://sandbox.vnpayment.vn/apis/docs/thanh-toan-pay/pay.html
  const SANDBOX_URL = process.env.VNPAY_PAY_URL
    ?? 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html';

  const params: Record<string, string> = {
    vnp_Version: '2.1.0',
    vnp_Command: 'pay',
    vnp_TmnCode: process.env.VNPAY_TMN_CODE!,
    vnp_Amount: String(args.amountVnd * 100), // VNPay tính theo đơn vị x100
    vnp_CurrCode: 'VND',
    vnp_TxnRef: args.orderCode,
    vnp_OrderInfo: args.description,
    vnp_OrderType: 'other',
    vnp_Locale: 'vn',
    vnp_ReturnUrl: process.env.VNPAY_RETURN_URL ?? args.returnUrl,
    vnp_IpAddr: args.clientIp ?? '127.0.0.1',
    vnp_CreateDate: formatVnpayDate(new Date()),
  };

  // Sort theo key asc rồi join query string
  const sortedKeys = Object.keys(params).sort();
  const queryString = sortedKeys
    .map((k) => `${k}=${encodeURIComponent(params[k]!).replace(/%20/g, '+')}`)
    .join('&');
  const signature = createHmac('sha512', process.env.VNPAY_HASH_SECRET!)
    .update(queryString)
    .digest('hex');

  const finalQs = `${queryString}&vnp_SecureHash=${signature}`;
  return {
    url: `${SANDBOX_URL}?${finalQs}`,
    request: params,
  };
}

function formatVnpayDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

async function buildMomoIntent(args: CreateIntentArgs): Promise<{
  url: string;
  request: Record<string, unknown>;
}> {
  // Ref: https://developers.momo.vn/v3/docs/payment/api/payment-method/aiov2
  const endpoint = process.env.MOMO_CREATE_URL
    ?? 'https://test-payment.momo.vn/v2/gateway/api/create';

  const partnerCode = process.env.MOMO_PARTNER_CODE!;
  const accessKey = process.env.MOMO_ACCESS_KEY!;
  const secretKey = process.env.MOMO_SECRET_KEY!;

  const requestId = `${args.orderCode}-${Date.now()}`;
  const orderId = args.orderCode;
  const requestType = 'captureWallet';
  const extraData = '';
  const ipnUrl = process.env.MOMO_IPN_URL ?? '';
  const redirectUrl = process.env.MOMO_RETURN_URL ?? args.returnUrl;

  // Raw signature theo spec MoMo (alphabetic order, key=value &)
  const rawSignature
    = `accessKey=${accessKey}`
    + `&amount=${args.amountVnd}`
    + `&extraData=${extraData}`
    + `&ipnUrl=${ipnUrl}`
    + `&orderId=${orderId}`
    + `&orderInfo=${args.description}`
    + `&partnerCode=${partnerCode}`
    + `&redirectUrl=${redirectUrl}`
    + `&requestId=${requestId}`
    + `&requestType=${requestType}`;
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

export async function createPaymentIntent(
  args: CreateIntentArgs,
): Promise<CreateIntentResult> {
  const requested = resolveProvider();

  if (requested === 'VNPAY' && isVnpayConfigured()) {
    const { url, request } = buildVnpayUrl(args);
    return { paymentUrl: url, rawRequest: request, resolvedProvider: 'VNPAY' };
  }

  if (requested === 'VNPAY') {
    console.warn(
      '[payment] VNPAY env chưa đủ (VNPAY_TMN_CODE / VNPAY_HASH_SECRET / VNPAY_RETURN_URL) — fallback STUB.',
    );
  }

  if (requested === 'MOMO' && isMomoConfigured()) {
    try {
      const { url, request } = await buildMomoIntent(args);
      return { paymentUrl: url, rawRequest: request, resolvedProvider: 'MOMO' };
    } catch (err) {
      console.warn(`[payment] MOMO create failed → fallback STUB: ${(err as Error).message}`);
    }
  }

  if (requested === 'MOMO' && !isMomoConfigured()) {
    console.warn('[payment] MOMO env chưa đủ — fallback STUB.');
  }

  // STUB: trả về URL local dẫn tới capture stub endpoint
  const stubUrl = `${args.returnUrl}?orderCode=${encodeURIComponent(args.orderCode)}&stub=1`;
  return {
    paymentUrl: stubUrl,
    rawRequest: { mode: 'stub', orderCode: args.orderCode, amount: args.amountVnd },
    resolvedProvider: 'STUB',
  };
}

// ──────────────────────────────────────────────────────────
// Refund
// ──────────────────────────────────────────────────────────

export type RefundArgs = {
  provider: PaymentProviderName;
  orderCode: string;
  /** Gốc giao dịch trả về từ provider khi capture (vnp_TransactionNo / transId). */
  providerRef: string | null;
  amountVnd: number;
  reason: string;
  /** UserId / email khởi tạo refund — VNPay yêu cầu vnp_CreateBy. */
  initiatedBy: string;
};

export type RefundResult = {
  ok: boolean;
  message: string;
  rawResponse: Record<string, unknown> | null;
};

/**
 * Refund 1 payment. Khi provider STUB → chỉ trả ok=true để caller flag DB.
 * VNPay/MoMo → gọi API thật (provider-specific).
 *
 * Caller chịu trách nhiệm update DB sau khi nhận RefundResult.ok = true.
 */
export async function refundPayment(args: RefundArgs): Promise<RefundResult> {
  if (args.provider === 'STUB') {
    return { ok: true, message: 'STUB refund — local flag', rawResponse: null };
  }

  if (args.provider === 'VNPAY') {
    if (!isVnpayConfigured() || !process.env.VNPAY_REFUND_URL) {
      return {
        ok: false,
        message: 'VNPay refund cần VNPAY_TMN_CODE/HASH_SECRET/REFUND_URL',
        rawResponse: null,
      };
    }
    if (!args.providerRef) {
      return { ok: false, message: 'Thiếu vnp_TransactionNo gốc', rawResponse: null };
    }

    // VNPay refund spec — POST body với HMAC-SHA512.
    // Field order theo doc: vnp_RequestId|vnp_Version|vnp_Command|vnp_TmnCode|
    //                      vnp_TransactionType|vnp_TxnRef|vnp_Amount|
    //                      vnp_TransactionNo|vnp_TransactionDate|vnp_CreateBy|
    //                      vnp_CreateDate|vnp_IpAddr|vnp_OrderInfo
    const now = new Date();
    const requestId = `RF-${args.orderCode}-${Date.now()}`;
    const createDate = formatVnpayDate(now);

    const fields = {
      vnp_RequestId: requestId,
      vnp_Version: '2.1.0',
      vnp_Command: 'refund',
      vnp_TmnCode: process.env.VNPAY_TMN_CODE!,
      vnp_TransactionType: '02', // 02 = full refund
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
    if (!isMomoConfigured() || !process.env.MOMO_REFUND_URL) {
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

    const rawSignature
      = `accessKey=${accessKey}`
      + `&amount=${args.amountVnd}`
      + `&description=${args.reason}`
      + `&orderId=${orderId}`
      + `&partnerCode=${partnerCode}`
      + `&requestId=${requestId}`
      + `&transId=${args.providerRef}`;
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

  return { ok: false, message: `Provider ${args.provider} không hỗ trợ refund`, rawResponse: null };
}

/**
 * Verify HMAC signature từ VNPay return / webhook. Returns true nếu hợp lệ.
 *
 * VNPay convention: receiver gom tất cả param trừ vnp_SecureHash[Type], sort
 * key asc, build query, HMAC-SHA512 với hash secret → compare với
 * vnp_SecureHash gốc (case insensitive).
 */
export function verifyVnpaySignature(params: Record<string, string>): boolean {
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
