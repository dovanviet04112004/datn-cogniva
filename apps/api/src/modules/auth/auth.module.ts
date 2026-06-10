import { Module } from '@nestjs/common';

import { PasswordService } from '../../common/auth/password.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RefreshTokenService } from './refresh-token.service';

/** AuthModule — JWT access/refresh thay Better Auth (plan §3, Wave 1). */
@Module({
  controllers: [AuthController],
  providers: [AuthService, PasswordService, RefreshTokenService],
})
export class AuthModule {}
