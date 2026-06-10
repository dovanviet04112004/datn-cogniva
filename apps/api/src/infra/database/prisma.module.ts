import { Global, Module } from '@nestjs/common';

import { PrismaService } from './prisma.service';

/** @Global — mọi domain module inject PrismaService không cần import lại. */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
