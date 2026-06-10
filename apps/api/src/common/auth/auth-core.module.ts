import { Global, Module } from '@nestjs/common';

import { LegacySessionService } from './legacy-session.service';
import { OptionalAuthService } from './optional-auth.service';
import { TokenService } from './token.service';

/**
 * AuthCoreModule — verify token/session dùng bởi AuthGuard toàn cục +
 * OptionalAuthService cho route @Public() có hành vi per-user khi login.
 * (AuthModule đầy đủ — sign-in/up/refresh/OAuth/2FA — là việc của Wave 1.)
 */
@Global()
@Module({
  providers: [TokenService, LegacySessionService, OptionalAuthService],
  exports: [TokenService, LegacySessionService, OptionalAuthService],
})
export class AuthCoreModule {}
