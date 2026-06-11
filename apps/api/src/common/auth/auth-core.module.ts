import { Global, Module } from '@nestjs/common';

import { OptionalAuthService } from './optional-auth.service';
import { TokenService } from './token.service';

@Global()
@Module({
  providers: [TokenService, OptionalAuthService],
  exports: [TokenService, OptionalAuthService],
})
export class AuthCoreModule {}
