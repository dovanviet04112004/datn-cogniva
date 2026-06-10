/**
 * AuthController — /api/auth/* của hệ JWT mới. Web nhận token qua httpOnly
 * cookie (cg_at 15' path=/, cg_rt 30d path=/api/auth); mobile nhận qua body
 * (SecureStore + Bearer). Cùng response body cho cả hai.
 *
 * Trong cửa sổ dual-stack, các path này CHƯA được proxy từ Next (Better Auth
 * vẫn giữ /api/auth/[...all]) — client mới gọi thẳng :4000 hoặc qua rewrite
 * từng path khi cutover (plan §3.3).
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Ip,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { TokenService } from '../../common/auth/token.service';
import type { AuthUser } from '../../common/auth/session.types';
import { AuthService, type AuthTokens } from './auth.service';
import {
  forgotPasswordSchema,
  refreshSchema,
  resetPasswordSchema,
  signInSchema,
  signUpSchema,
  type ForgotPasswordInput,
  type RefreshInput,
  type ResetPasswordInput,
  type SignInInput,
  type SignUpInput,
} from './dto/auth.dto';

const ACCESS_COOKIE = 'cg_at';
const REFRESH_COOKIE = 'cg_rt';
const ACCESS_MAX_AGE_MS = 15 * 60 * 1000;

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
  ) {}

  private setCookies(res: Response, t: AuthTokens) {
    const secure = process.env.NODE_ENV === 'production';
    res.cookie(ACCESS_COOKIE, t.accessToken, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/',
      maxAge: ACCESS_MAX_AGE_MS,
    });
    res.cookie(REFRESH_COOKIE, t.refreshToken, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/api/auth',
      expires: t.refreshExpiresAt,
    });
  }

  private clearCookies(res: Response) {
    res.clearCookie(ACCESS_COOKIE, { path: '/' });
    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
  }

  private readRefreshCookie(req: Request): string | undefined {
    return req.headers.cookie
      ?.split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${REFRESH_COOKIE}=`))
      ?.slice(REFRESH_COOKIE.length + 1);
  }

  @Public()
  @Post('sign-up')
  async signUp(
    @Body(new ZodValidationPipe(signUpSchema)) body: SignUpInput,
    @Res({ passthrough: true }) res: Response,
    @Req() req: Request,
    @Ip() ip: string,
  ) {
    const t = await this.auth.signUp(body, { ip, userAgent: req.headers['user-agent'] });
    this.setCookies(res, t);
    return { user: t.user, accessToken: t.accessToken, refreshToken: t.refreshToken };
  }

  @Public()
  @HttpCode(200)
  @Post('sign-in')
  async signIn(
    @Body(new ZodValidationPipe(signInSchema)) body: SignInInput,
    @Res({ passthrough: true }) res: Response,
    @Req() req: Request,
    @Ip() ip: string,
  ) {
    const t = await this.auth.signIn(body, { ip, userAgent: req.headers['user-agent'] });
    this.setCookies(res, t);
    return { user: t.user, accessToken: t.accessToken, refreshToken: t.refreshToken };
  }

  @Public()
  @HttpCode(200)
  @Post('refresh')
  async refresh(
    @Body(new ZodValidationPipe(refreshSchema)) body: RefreshInput,
    @Res({ passthrough: true }) res: Response,
    @Req() req: Request,
    @Ip() ip: string,
  ) {
    const raw = body.refreshToken ?? this.readRefreshCookie(req);
    if (!raw) return { error: 'Thiếu refresh token' };
    const t = await this.auth.refresh(raw, { ip, userAgent: req.headers['user-agent'] });
    this.setCookies(res, t);
    return { user: t.user, accessToken: t.accessToken, refreshToken: t.refreshToken };
  }

  @Public()
  @HttpCode(200)
  @Post('sign-out')
  async signOut(
    @Res({ passthrough: true }) res: Response,
    @Req() req: Request,
    @Body(new ZodValidationPipe(refreshSchema)) body: RefreshInput,
  ) {
    const raw = body.refreshToken ?? this.readRefreshCookie(req);
    const user = (req as Request & { user?: AuthUser }).user;
    await this.auth.signOut(raw, user?.id);
    this.clearCookies(res);
    return { ok: true };
  }

  @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    return { user: await this.auth.me(user.id) };
  }

  /** Public keys (RFC 7517) — realtime/hocuspocus/gateway verify cục bộ. */
  @Public()
  @Get('jwks')
  jwks() {
    return this.tokens.getJwks();
  }

  @Public()
  @HttpCode(200)
  @Post('forgot-password')
  async forgotPassword(@Body(new ZodValidationPipe(forgotPasswordSchema)) body: ForgotPasswordInput) {
    const { devToken } = await this.auth.forgotPassword(body.email);
    return { ok: true, ...(devToken ? { devToken } : {}) };
  }

  @Public()
  @HttpCode(200)
  @Post('reset-password')
  async resetPassword(@Body(new ZodValidationPipe(resetPasswordSchema)) body: ResetPasswordInput) {
    await this.auth.resetPassword(body.token, body.newPassword);
    return { ok: true };
  }
}
