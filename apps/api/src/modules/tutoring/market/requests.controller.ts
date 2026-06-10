/**
 * /api/tutoring/{requests,applications} — marketplace request flow.
 *
 * GET requests/:id public (session optional — owner thấy applications, tutor
 * thấy myApplication) → @Public() + OptionalAuthService. GET requests (list)
 * KHÔNG port — SSR query DB trực tiếp.
 *
 * Body parse trong service SAU các check owner/status để giữ THỨ TỰ lỗi của
 * route cũ (vd PATCH: 404 → 403 → 400) — trừ applications PATCH (cũ parse
 * body trước) dùng ZodValidationPipe được.
 */
import {
  Body,
  Controller,
  Get,
  HttpException,
  Param,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
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

  /** POST requests — student tạo request; rate limit 'default' giữ NGUYÊN key cũ. */
  @Post('requests')
  async create(
    @CurrentUser() user: AuthUser,
    @Body() raw: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const rl = await checkLimit(`tutoring-request:${user.id}`, 'default');
    if (!rl.allowed) {
      res.setHeader('Retry-After', String(rl.retryAfter ?? 60));
      throw new HttpException(
        { error: 'Quá nhiều yêu cầu — hôm nay bạn đã post tối đa rồi' },
        429,
      );
    }
    return this.requests.create(user.id, raw);
  }

  /** GET requests/:id — detail public, session best-effort. */
  @Public()
  @Get('requests/:id')
  async detail(@Param('id') id: string, @Req() req: Request) {
    const user = await this.optionalAuth.resolveUser(req);
    return this.requests.detail(id, user?.id ?? null);
  }

  /** PATCH requests/:id — owner update/close. */
  @Patch('requests/:id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() raw: unknown,
  ) {
    return this.requests.update(user.id, id, raw);
  }

  /** POST requests/:id/apply — tutor apply; đã apply → 409. */
  @Post('requests/:id/apply')
  apply(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() raw: unknown,
  ) {
    return this.requests.apply(user.id, id, raw);
  }

  /** PATCH applications/:id — student accept (cascade reject) / reject. */
  @Patch('applications/:id')
  patchApplication(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(APP_PATCH_SCHEMA)) body: ApplicationPatchInput,
  ) {
    return this.requests.patchApplication(user.id, id, body);
  }
}
