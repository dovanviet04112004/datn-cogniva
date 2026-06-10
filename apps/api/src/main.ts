/**
 * Bootstrap HTTP cho @cogniva/api — NestJS modular monolith (:4000, prefix /api).
 *
 * Trong giai đoạn strangler-fig, traffic tới đây qua reverse-proxy cùng origin
 * (dev: next.config rewrites; prod: Caddy) — vì vậy KHÔNG bật CORS: browser
 * không bao giờ thấy origin khác.
 */
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import type { NestExpressApplication } from '@nestjs/platform-express';

import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();

  // Swagger /api/docs — DTO sẽ phủ dần theo từng wave migrate.
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Cogniva API')
    .setDescription('Backend NestJS — xem docs/plans/nestjs-migration.md')
    .setVersion('0.1')
    .addBearerAuth()
    .addCookieAuth('better-auth.session_token')
    .build();
  SwaggerModule.setup('api/docs', app, () =>
    SwaggerModule.createDocument(app, swaggerConfig),
  );

  await app.listen(process.env.PORT ?? 4000);
}

void bootstrap();
