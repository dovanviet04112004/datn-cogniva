/**
 * Root module — gom config + infra (Prisma/Redis) + guard/filter toàn cục
 * + các domain module (thêm dần theo wave).
 */
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';

import { validateEnv } from './infra/config/env.schema';
import { PrismaModule } from './infra/database/prisma.module';
import { RedisModule } from './infra/redis/redis.module';
import { AuthCoreModule } from './common/auth/auth-core.module';
import { AppExceptionFilter } from './common/filters/app-exception.filter';
import { AuthGuard } from './common/guards/auth.guard';
import { AuthModule } from './modules/auth/auth.module';
import { GamificationModule } from './modules/gamification/gamification.module';
import { HealthModule } from './modules/health/health.module';
import { SpikeModule } from './modules/spike/spike.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
        transport:
          process.env.NODE_ENV === 'production'
            ? undefined
            : { target: 'pino-pretty', options: { singleLine: true } },
      },
    }),
    PrismaModule,
    RedisModule,
    AuthCoreModule,
    AuthModule,
    UsersModule,
    GamificationModule,
    HealthModule,
    SpikeModule,
  ],
  providers: [
    // Mọi route mặc định yêu cầu đăng nhập — mở public bằng @Public().
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: AppExceptionFilter },
  ],
})
export class AppModule {}
