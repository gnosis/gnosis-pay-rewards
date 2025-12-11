import { Application } from '@oak/oak';
import { createRouter, type CreateRouterParams } from './api/router.ts';
import { withErrorHandler, withResponseSchema } from '@kpk/apps-sdk/server';

export function createHttpServer(params: CreateRouterParams) {
  // Initialize Oak application
  const app = new Application();
  const { logger } = params;

  // Global error handling middleware
  app.use(withErrorHandler());

  // Global response schema middleware
  app.use(withResponseSchema());

  // CORS middleware
  app.use(async (ctx, next) => {
    ctx.response.headers.set('Access-Control-Allow-Origin', '*');
    ctx.response.headers.set(
      'Access-Control-Allow-Methods',
      'GET, POST, DELETE, OPTIONS',
    );
    ctx.response.headers.set(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization',
    );

    if (ctx.request.method === 'OPTIONS') {
      ctx.response.status = 204;
      return;
    }

    await next();
  });

  // Logger
  app.use(async (ctx, next) => {
    await next();
    const rt = ctx.response.headers.get('X-Response-Time');
    logger?.info(
      `${ctx.request.method} ${ctx.request.url} - ${ctx.response.status} - ${rt}`,
    );
  });

  const router = createRouter(params);

  app.use(router.routes());
  app.use(router.allowedMethods());

  app.addEventListener('listen', ({ hostname, port, secure }) => {
    logger?.info(
      `🚀 Server listening on ${secure ? 'https' : 'http'}://${hostname ?? 'localhost'}:${port}`,
    );
  });

  return app;
}
