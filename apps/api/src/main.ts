import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import type { NestExpressApplication } from '@nestjs/platform-express';

import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    rawBody: true,
  });
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();

  app.useBodyParser('json', {
    limit: '10mb',
    type: ['application/json', 'application/webhook+json'],
  });
  app.useBodyParser('urlencoded', { limit: '10mb', extended: true });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Cogniva API')
    .setDescription('Backend NestJS — xem docs/plans/nestjs-migration.md')
    .setVersion('0.1')
    .addBearerAuth()
    .addCookieAuth('cg_at')
    .build();
  SwaggerModule.setup('api/docs', app, () => SwaggerModule.createDocument(app, swaggerConfig));

  await app.listen(process.env.PORT ?? 4000);
}

void bootstrap();
