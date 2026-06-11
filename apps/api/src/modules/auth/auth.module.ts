import { Module } from '@nestjs/common';

import { PasswordService } from '../../common/auth/password.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { GoogleOauthService } from './google-oauth.service';
import { RefreshTokenService } from './refresh-token.service';
import { TwoFactorManageService } from './two-factor-manage.service';
import { TwoFactorService } from './two-factor.service';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    RefreshTokenService,
    TwoFactorService,
    TwoFactorManageService,
    GoogleOauthService,
  ],
})
export class AuthModule {}
