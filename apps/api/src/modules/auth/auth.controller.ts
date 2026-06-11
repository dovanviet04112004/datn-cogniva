/**
 * AuthController — /api/auth/* của hệ JWT mới. Web nhận token qua httpOnly
 * cookie (cg_at 15' path=/, cg_rt 30d path=/api/auth) + DUAL-ISSUE cookie
 * session Better Auth (SSR cũ vẫn nhận user — gỡ cuối GĐ1); mobile nhận qua
 * body (SecureStore + Bearer). Sign-in 2 bước khi user bật 2FA.
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Ip,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { TokenService } from '../../common/auth/token.service';
import type { AuthUser } from '../../common/auth/session.types';
import { AuthService, type AuthTokens, type TwoFactorChallenge } from './auth.service';
import { GoogleOauthService } from './google-oauth.service';
import { TwoFactorManageService } from './two-factor-manage.service';
import {
  forgotPasswordSchema,
  refreshSchema,
  resetPasswordSchema,
  signInSchema,
  signUpSchema,
  twoFactorCodeSchema,
  twoFactorPasswordSchema,
  twoFactorSchema,
  type ForgotPasswordInput,
  type RefreshInput,
  type ResetPasswordInput,
  type SignInInput,
  type SignUpInput,
  type TwoFactorInput,
} from './dto/auth.dto';

const ACCESS_COOKIE = 'cg_at';
const REFRESH_COOKIE = 'cg_rt';
const OAUTH_STATE_COOKIE = 'cg_oauth';
const ACCESS_MAX_AGE_MS = 15 * 60 * 1000;
const PROD = () => process.env.NODE_ENV === 'production';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
    private readonly google: GoogleOauthService,
    private readonly twoFactorManage: TwoFactorManageService,
  ) {}

  private setCookies(res: Response, t: AuthTokens) {
    const secure = PROD();
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

  private readCookie(req: Request, name: string): string | undefined {
    return req.headers.cookie
      ?.split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${name}=`))
      ?.slice(name.length + 1);
  }

  /** Body cho cả web (cookie) lẫn mobile (token trong body). */
  private toBody(t: AuthTokens | TwoFactorChallenge) {
    if ('twoFactorRequired' in t) return t;
    return { user: t.user, accessToken: t.accessToken, refreshToken: t.refreshToken };
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
    return this.toBody(t);
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
    if (!('twoFactorRequired' in t)) this.setCookies(res, t);
    return this.toBody(t);
  }

  @Public()
  @HttpCode(200)
  @Post('sign-in/2fa')
  async signInTwoFactor(
    @Body(new ZodValidationPipe(twoFactorSchema)) body: TwoFactorInput,
    @Res({ passthrough: true }) res: Response,
    @Req() req: Request,
    @Ip() ip: string,
  ) {
    const t = await this.auth.signInTwoFactor(body.challengeToken, body.code, {
      ip,
      userAgent: req.headers['user-agent'],
    });
    this.setCookies(res, t);
    return this.toBody(t);
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
    const raw = body.refreshToken ?? this.readCookie(req, REFRESH_COOKIE);
    if (!raw) return { error: 'Thiếu refresh token' };
    const t = await this.auth.refresh(raw, { ip, userAgent: req.headers['user-agent'] });
    this.setCookies(res, t);
    return this.toBody(t);
  }

  @Public()
  @HttpCode(200)
  @Post('sign-out')
  async signOut(
    @Res({ passthrough: true }) res: Response,
    @Req() req: Request,
    @Body(new ZodValidationPipe(refreshSchema)) body: RefreshInput,
  ) {
    const raw = body.refreshToken ?? this.readCookie(req, REFRESH_COOKIE);
    const user = (req as Request & { user?: AuthUser }).user;
    await this.auth.signOut(raw, user?.id);
    this.clearCookies(res);
    return { ok: true };
  }

  @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    return { user: await this.auth.me(user.id) };
  }

  // ── 2FA enable/verify/disable — thay authClient.twoFactor.* (Better Auth) ──

  @HttpCode(200)
  @Post('2fa/enable')
  async twoFactorEnable(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(twoFactorPasswordSchema)) body: { password: string },
  ) {
    return this.twoFactorManage.enable({ id: user.id, email: user.email }, body.password);
  }

  @HttpCode(200)
  @Post('2fa/verify')
  async twoFactorVerifyEnable(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(twoFactorCodeSchema)) body: { code: string },
  ) {
    await this.twoFactorManage.verifyEnable(user.id, body.code);
    return { ok: true };
  }

  @HttpCode(200)
  @Post('2fa/disable')
  async twoFactorDisable(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(twoFactorPasswordSchema)) body: { password: string },
  ) {
    await this.twoFactorManage.disable(user.id, body.password);
    return { ok: true };
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

  // ── Google OAuth (authorization-code, state chống CSRF qua cookie) ──

  @Public()
  @Get('google')
  googleRedirect(@Query('redirect') redirect: string | undefined, @Res() res: Response) {
    const state = randomBytes(16).toString('base64url');
    // Chỉ cho redirect nội bộ ('/x' — không '//evil.com') để tránh open-redirect.
    const safeRedirect = redirect?.startsWith('/') && !redirect.startsWith('//') ? redirect : '/dashboard';
    res.cookie(OAUTH_STATE_COOKIE, JSON.stringify({ state, redirect: safeRedirect }), {
      httpOnly: true,
      secure: PROD(),
      sameSite: 'lax',
      path: '/api/auth',
      maxAge: 10 * 60 * 1000,
    });
    res.redirect(this.google.buildAuthUrl(state));
  }

  @Public()
  @Get('google/callback')
  async googleCallback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
    @Ip() ip: string,
  ) {
    const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
    const stored = this.readCookie(req, OAUTH_STATE_COOKIE);
    res.clearCookie(OAUTH_STATE_COOKIE, { path: '/api/auth' });

    let redirect = '/dashboard';
    try {
      const parsed = stored ? (JSON.parse(decodeURIComponent(stored)) as { state: string; redirect: string }) : null;
      if (!code || !state || !parsed || parsed.state !== state) throw new Error('state mismatch');
      redirect = parsed.redirect;

      const profile = await this.google.exchangeCode(code);
      const user = await this.google.upsertUser(profile);
      const t = await this.auth.issueTokens(
        { id: user.id, email: user.email, name: user.name, image: user.image, plan: user.plan, adminRole: user.admin_role },
        { ip, userAgent: req.headers['user-agent'] },
      );
      this.setCookies(res, t);
      res.redirect(`${appUrl}${redirect}`);
    } catch {
      res.redirect(`${appUrl}/sign-in?error=oauth`);
    }
  }
}
