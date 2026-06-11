import { Body, Controller, Get, HttpException, Param, Patch, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { checkLimit } from '@cogniva/server-core/rate-limit';
import type { Request, Response } from 'express';

import { OptionalAuthService } from '../../../common/auth/optional-auth.service';
import type { AuthUser } from '../../../common/auth/session.types';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import {
  APP_PATCH_SCHEMA,
  TutoringRequestsService,
  type ApplicationPatchInput,
} from './requests.service';

@ApiTags('tutoring')
@Controller('tutoring')
export class TutoringRequestsController {
  constructor(
    private readonly requests: TutoringRequestsService,
    private readonly optionalAuth: OptionalAuthService,
  ) {}

  @Post('requests')
  async create(
    @CurrentUser() user: AuthUser,
    @Body() raw: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const rl = await checkLimit(`tutoring-request:${user.id}`, 'default');
    if (!rl.allowed) {
      res.setHeader('Retry-After', String(rl.retryAfter ?? 60));
      throw new HttpException({ error: 'Quá nhiều yêu cầu — hôm nay bạn đã post tối đa rồi' }, 429);
    }
    return this.requests.create(user.id, raw);
  }

  @Public()
  @Get('requests/:id')
  async detail(@Param('id') id: string, @Req() req: Request) {
    const user = await this.optionalAuth.resolveUser(req);
    return this.requests.detail(id, user?.id ?? null);
  }

  @Patch('requests/:id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() raw: unknown) {
    return this.requests.update(user.id, id, raw);
  }

  @Post('requests/:id/apply')
  apply(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() raw: unknown) {
    return this.requests.apply(user.id, id, raw);
  }

  @Patch('applications/:id')
  patchApplication(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(APP_PATCH_SCHEMA)) body: ApplicationPatchInput,
  ) {
    return this.requests.patchApplication(user.id, id, body);
  }
}
