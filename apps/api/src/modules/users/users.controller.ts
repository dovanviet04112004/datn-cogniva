import { Body, Controller, Get, NotFoundException, Param, Patch, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ACHIEVEMENT_META } from '@cogniva/server-core';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/auth/session.types';
import { UsersService } from './users.service';
import {
  patchProfileSchema,
  putStatusSchema,
  type PatchProfileInput,
  type PutStatusInput,
} from './dto/users.dto';

@ApiTags('profile')
@Controller('profile')
export class ProfileController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    const data = await this.users.getProfileMe(user.id);
    return { ...data, achievementMeta: ACHIEVEMENT_META };
  }

  @Patch('me')
  async patchMe(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(patchProfileSchema)) body: PatchProfileInput,
  ) {
    return this.users.updateProfileMe(user.id, body);
  }

  @Public()
  @Get(':id')
  async publicProfile(@Param('id') id: string) {
    const payload = await this.users.getPublicProfile(id);
    if (!payload) throw new NotFoundException({ error: 'Not found' });
    return { ...payload, achievementMeta: ACHIEVEMENT_META };
  }
}

@ApiTags('user')
@Controller('user/status')
export class UserStatusController {
  constructor(private readonly users: UsersService) {}

  @Get()
  getStatus(@CurrentUser() user: AuthUser) {
    return this.users.getStatus(user.id);
  }

  @Put()
  putStatus(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(putStatusSchema)) body: PutStatusInput,
  ) {
    return this.users.updateStatus(user.id, body);
  }
}
