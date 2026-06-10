import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

import type { AuthUser } from '../auth/session.types';

/** Lấy user đã được AuthGuard verify: `@CurrentUser() user: AuthUser`. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser =>
    ctx.switchToHttp().getRequest().user,
);
