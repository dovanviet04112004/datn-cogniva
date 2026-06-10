import { Global, Module } from '@nestjs/common';

import { LegacySessionService } from './legacy-session.service';
import { TokenService } from './token.service';

/**
 * AuthCoreModule — verify token/session dùng bởi AuthGuard toàn cục.
 * (AuthModule đầy đủ — sign-in/up/refresh/OAuth/2FA — là việc của Wave 1.)
 */
@Global()
@Module({
  providers: [TokenService, LegacySessionService],
  exports: [TokenService, LegacySessionService],
})
export class AuthCoreModule {}
