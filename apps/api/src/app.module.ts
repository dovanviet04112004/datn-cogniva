import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';

import { validateEnv } from './infra/config/env.schema';
import { AiModule } from './infra/ai/ai.module';
import { PrismaModule } from './infra/database/prisma.module';
import { LivekitModule } from './infra/livekit/livekit.module';
import { RedisModule } from './infra/redis/redis.module';
import { StorageModule } from './infra/storage/storage.module';
import { AuthCoreModule } from './common/auth/auth-core.module';
import { AppExceptionFilter } from './common/filters/app-exception.filter';
import { AuthGuard } from './common/guards/auth.guard';
import { AccountModule } from './modules/account/account.module';
import { AdminCoreModule } from './modules/admin/core/admin-core.module';
import { AdminDomainModule } from './modules/admin/domain/admin-domain.module';
import { AuthModule } from './modules/auth/auth.module';
import { ChannelsModule } from './modules/channels/channels.module';
import { ChatModule } from './modules/chat/chat.module';
import { ChannelsVoiceModule } from './modules/channels/channels-voice.module';
import { ConversationsModule } from './modules/conversations/conversations.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { ExamsModule } from './modules/exams/exams.module';
import { FlashcardsModule } from './modules/flashcards/flashcards.module';
import { GamificationModule } from './modules/gamification/gamification.module';
import { GraphModule } from './modules/graph/graph.module';
import { GroupsModule } from './modules/groups/groups.module';
import { HealthModule } from './modules/health/health.module';
import { LearningModule } from './modules/learning/learning.module';
import { LibraryAnnotationsModule } from './modules/library/annotations/annotations.module';
import { LibraryContentModule } from './modules/library/content/content.module';
import { LibrarySearchModule } from './modules/library/search/search.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { QuizModule } from './modules/quiz/quiz.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { RoomsModule } from './modules/rooms/rooms.module';
import { SearchModule } from './modules/search/search.module';
import { TutoringBookingsModule } from './modules/tutoring/bookings/bookings.module';
import { TutoringConciergeModule } from './modules/tutoring/concierge/concierge.module';
import { TutoringMarketModule } from './modules/tutoring/market/market.module';
import { TutorsModule } from './modules/tutoring/tutors/tutors.module';
import { UsersModule } from './modules/users/users.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { WorkspacesModule } from './modules/workspaces/workspaces.module';

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
    AiModule,
    StorageModule,
    LivekitModule,
    AuthCoreModule,
    AuthModule,
    UsersModule,
    GamificationModule,
    LearningModule,
    GraphModule,
    SearchModule,
    WorkspacesModule,
    DocumentsModule,
    FlashcardsModule,
    QuizModule,
    ExamsModule,
    ConversationsModule,
    DashboardModule,
    GroupsModule,
    ChannelsModule,
    ChannelsVoiceModule,
    RoomsModule,
    NotificationsModule,
    RealtimeModule,
    PaymentsModule,
    TutorsModule,
    TutoringBookingsModule,
    TutoringMarketModule,
    TutoringConciergeModule,
    WebhooksModule,
    ChatModule,
    AdminCoreModule,
    AdminDomainModule,
    AccountModule,
    LibraryContentModule,
    LibrarySearchModule,
    LibraryAnnotationsModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: AppExceptionFilter },
  ],
})
export class AppModule {}
