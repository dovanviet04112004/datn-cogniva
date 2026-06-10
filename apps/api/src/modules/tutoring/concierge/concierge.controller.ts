/**
 * /api/tutoring/concierge/** — port từ route Next:
 *   GET  concierge/threads               — list ≤20 thread của user
 *   POST concierge/threads               — tạo thread trống (201)
 *   GET  concierge/threads/:id/messages  — messages ASC + hydrate metadata
 *   POST concierge/threads/:id/messages  — agent loop, trả SSE stream
 *
 * concierge/search KHÔNG port — dead route (0 caller, logic search nằm
 * trong messages POST).
 */
import { Body, Controller, Get, Param, Post, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';

import type { AuthUser } from '../../../common/auth/session.types';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { ConciergeService } from './concierge.service';

const POST_MESSAGE_SCHEMA = z.object({
  message: z.string().min(1).max(2000),
});

@ApiTags('tutoring')
@Controller('tutoring')
export class ConciergeController {
  constructor(private readonly concierge: ConciergeService) {}

  @Get('concierge/threads')
  listThreads(@CurrentUser() user: AuthUser) {
    return this.concierge.listThreads(user.id);
  }

  @Post('concierge/threads')
  createThread(@CurrentUser() user: AuthUser) {
    return this.concierge.createThread(user.id);
  }

  @Get('concierge/threads/:id/messages')
  listMessages(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.concierge.listMessages(user.id, id);
  }

  @Post('concierge/threads/:id/messages')
  postMessage(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(POST_MESSAGE_SCHEMA))
    body: z.infer<typeof POST_MESSAGE_SCHEMA>,
    @Res() res: Response,
  ) {
    return this.concierge.postMessage(user, id, body.message, res);
  }
}
