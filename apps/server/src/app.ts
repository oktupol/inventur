import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import type { HealthResponse } from '@inventur/shared';
import type { Config } from './config.ts';
import { EventBus } from './realtime/event-bus.ts';
import type { RealtimeHub } from './realtime/hub.ts';
import { registerRealtime } from './realtime/plugin.ts';

declare module 'fastify' {
  interface FastifyInstance {
    /** Publishes domain events to realtime clients. */
    events: EventBus;
    realtime: RealtimeHub;
  }
}

export type AppOptions = Pick<Config, 'version'> &
  Partial<Pick<Config, 'staticDir'>> & {
    events?: EventBus;
  };

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' });
  const events = options.events ?? new EventBus();
  app.decorate('events', events);

  app.decorate('realtime', await registerRealtime(app, { events }));

  // The Docker health check polls every 10 seconds, so skip the request log.
  app.get('/api/health', { logLevel: 'warn' }, async (): Promise<HealthResponse> => {
    return { status: 'ok', version: options.version };
  });

  if (options.staticDir) {
    await app.register(fastifyStatic, { root: options.staticDir, wildcard: false });
  }

  app.setNotFoundHandler((request, reply) => {
    const isApi = request.url === '/api' || request.url.startsWith('/api/');
    if (options.staticDir && request.method === 'GET' && !isApi) {
      // Single-page app: unknown paths such as /admin or /scan get index.html.
      return reply.sendFile('index.html');
    }
    return reply.code(404).send({ error: 'Not found' });
  });

  return app;
}
