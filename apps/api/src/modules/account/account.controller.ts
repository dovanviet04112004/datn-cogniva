/**
 * /api/account/* — port từ apps/web/src/app/api/account/** (delete/export/
 * usage/push-token). Mọi route cần session (AuthGuard global lo 401
 * {error:'Unauthorized'}). COPPA (parental-consent) đã CẮT khỏi scope —
 * không port.
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { checkLimit } from '@cogniva/server-core/rate-limit';

import type { AuthUser } from '../../common/auth/session.types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AccountService, type RequestContext } from './account.service';
import {
  deletePushTokenSchema,
  registerPushTokenSchema,
  type DeletePushTokenInput,
  type RegisterPushTokenInput,
} from './dto/account.dto';

/**
 * Port extractRequestContext (web lib/observability/audit.ts) sang express:
 * ưu tiên cf-connecting-ip → x-forwarded-for (IP đầu) → x-real-ip.
 */
function extractRequestContext(req: Request): RequestContext {
  const xffRaw = req.headers['x-forwarded-for'];
  const xff = Array.isArray(xffRaw) ? xffRaw[0] : xffRaw;
  const realIp = req.headers['x-real-ip'] as string | undefined;
  const cfIp = req.headers['cf-connecting-ip'] as string | undefined;
  const ipAddress = cfIp || (xff ? xff.split(',')[0]!.trim() : null) || realIp || null;

  return {
    ipAddress,
    userAgent: (req.headers['user-agent'] as string | undefined) ?? null,
    traceId: (req.headers['x-trace-id'] as string | undefined) ?? null,
  };
}

@ApiTags('account')
@Controller('account')
export class AccountController {
  constructor(private readonly account: AccountService) {}

  // ──────────────────────────────────────────────────────────
  // GDPR Art. 17 — deletion request (cron process-gdpr-deletion xử lý hard delete)
  // ──────────────────────────────────────────────────────────

  /** POST /account/delete — body validate trong service (audit cả nhánh denied). */
  @HttpCode(200)
  @Post('delete')
  requestDelete(@CurrentUser() user: AuthUser, @Body() raw: unknown, @Req() req: Request) {
    return this.account.requestDelete(user.id, raw, extractRequestContext(req));
  }

  /** DELETE /account/delete — undo trong grace window. */
  @Delete('delete')
  cancelDelete(@CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.account.cancelDelete(user.id, extractRequestContext(req));
  }

  /** GET /account/delete — status cho banner UI. */
  @Get('delete')
  deletionStatus(@CurrentUser() user: AuthUser) {
    return this.account.deletionStatus(user.id);
  }

  // ──────────────────────────────────────────────────────────
  // GDPR Art. 20 — export toàn bộ data JSON download
  // ──────────────────────────────────────────────────────────

  /**
   * POST /account/export — trả body pretty-print + Content-Disposition để
   * browser auto-download (passthrough res, return string y bytes route cũ).
   */
  @HttpCode(200)
  @Post('export')
  async export(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ctx = extractRequestContext(req);

    // Key + preset y route cũ (comment "1/day" của web SAI — code thật là
    // preset aiGenerate 10/min, giữ nguyên hành vi code).
    const rl = await checkLimit(`gdpr-export:${user.id}`, 'aiGenerate');
    if (!rl.allowed) {
      await this.account.auditExportDenied(user.id, rl.retryAfter, ctx);
      res.setHeader('Retry-After', String(rl.retryAfter ?? 60));
      throw new HttpException({ error: 'Quá nhiều request export. Hãy đợi rồi thử lại.' }, 429);
    }

    const payload = await this.account.export(user.id, ctx);

    res.setHeader('Content-Type', 'application/json');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="cogniva-export-${user.id.slice(0, 8)}-${Date.now()}.json"`,
    );
    res.setHeader('Cache-Control', 'no-store');
    return JSON.stringify(payload, null, 2);
  }

  // ──────────────────────────────────────────────────────────
  // AI usage quota
  // ──────────────────────────────────────────────────────────

  /** GET /account/usage — plan/spent/quota/resetAt (shape UsageDTO shared). */
  @Get('usage')
  usage(@CurrentUser() user: AuthUser) {
    return this.account.usage(user.id, user.plan);
  }

  // ──────────────────────────────────────────────────────────
  // Expo push token (mobile)
  // ──────────────────────────────────────────────────────────

  /** POST /account/push-token — idempotent upsert, mobile gọi mỗi lần app mở. */
  @HttpCode(200)
  @Post('push-token')
  registerPushToken(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(registerPushTokenSchema)) body: RegisterPushTokenInput,
    @Req() req: Request,
  ) {
    return this.account.registerPushToken(user.id, body, extractRequestContext(req));
  }

  /** DELETE /account/push-token — unregister 1 token cụ thể (sign-out 1 device). */
  @Delete('push-token')
  unregisterPushToken(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(deletePushTokenSchema)) body: DeletePushTokenInput,
    @Req() req: Request,
  ) {
    return this.account.unregisterPushToken(user.id, body, extractRequestContext(req));
  }
}
