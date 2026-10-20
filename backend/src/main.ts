import './env.js';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // AG-UI clients POST the full message history + shared state (which includes the plan) each run.
  app.useBodyParser('json', { limit: '10mb' });
  app.setGlobalPrefix('api');
  app.enableCors({ origin: process.env.CORS_ORIGIN?.split(',') ?? true });
  app.enableShutdownHooks();
  const swagger = new DocumentBuilder()
    .setTitle('Yatra AI — Travel Planning Multi-Agent API')
    .setDescription(
      'NestJS backend for a LangGraph multi-agent travel planner for India. ' +
        'REST endpoints, an AG-UI (Server-Sent Events) endpoint, and a Socket.IO channel (`trip:plan`, not shown here).',
    )
    .setVersion('1.0')
    .addTag('AG-UI', 'Agent–User Interaction protocol endpoint (streaming)')
    .addTag('Trips', 'Plan, refine and retrieve trips')
    .addTag('Health', 'Service and provider status')
    .build();
  SwaggerModule.setup('api/docs', app, () => SwaggerModule.createDocument(app, swagger), {
    jsonDocumentUrl: 'api/docs-json',
    customSiteTitle: 'Yatra AI API docs',
  });

  const port = Number(process.env.PORT ?? 4100);
  await app.listen(port);
  Logger.log(`Travel planner API on http://localhost:${port}/api — Swagger: /api/docs · AG-UI: POST /api/agui (SSE) · Socket.IO on same port`, 'Bootstrap');
}
await bootstrap();
