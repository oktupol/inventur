import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import type { ApiError, HealthResponse } from '@inventur/shared';
import type { Config } from './config.ts';
import type { Db } from './db/connection.ts';
import { registerErrorHandler } from './http/error-handler.ts';
import { EventBus } from './realtime/event-bus.ts';
import type { RealtimeHub } from './realtime/hub.ts';
import { registerRealtime } from './realtime/plugin.ts';
import { checkpointRoutes } from './checkpoint/routes.ts';
import { employeeRoutes } from './employee/routes.ts';
import { entryRoutes } from './entry/routes.ts';
import { pairingRoutes } from './pairing/routes.ts';
import { searchRoutes } from './search/routes.ts';
import { stationRoutes } from './station/routes.ts';
import { stocktakeRoutes } from './stocktake/routes.ts';
import { workAreaRoutes } from './work-area/routes.ts';
import { workstationRoutes } from './workstation/routes.ts';

declare module 'fastify' {
  interface FastifyInstance {
    /** Publishes domain events to realtime clients. */
    events: EventBus;
    realtime: RealtimeHub;
  }
}

export type AppOptions = Pick<Config, 'version'> &
  Partial<Pick<Config, 'staticDir' | 'publicHost'>> & {
    events?: EventBus;
    /** Without a database, only the health check, realtime and the frontend are available. */
    db?: Db;
  };

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' });
  const events = options.events ?? new EventBus();
  app.decorate('events', events);
  registerErrorHandler(app);

  app.decorate('realtime', await registerRealtime(app, { events }));

  // The Docker health check polls every 10 seconds, so skip the request log.
  app.get('/api/health', { logLevel: 'warn' }, async (): Promise<HealthResponse> => {
    return { status: 'ok', version: options.version };
  });

  if (options.db) {
    const context = { db: options.db, events, publicHost: options.publicHost };
    await stocktakeRoutes(app, context);
    await employeeRoutes(app, context);
    await workAreaRoutes(app, context);
    await workstationRoutes(app, context);
    await stationRoutes(app, context);
    await searchRoutes(app, context);
    await entryRoutes(app, context);
    await checkpointRoutes(app, context);
    await pairingRoutes(app, context);
  }

  if (options.staticDir) {
    await app.register(fastifyStatic, { root: options.staticDir, wildcard: false });
  }

  app.setNotFoundHandler((request, reply) => {
    const isApi = request.url === '/api' || request.url.startsWith('/api/');
    if (options.staticDir && request.method === 'GET' && !isApi) {
      // Single-page app: unknown paths such as /admin or /scan get index.html.
      return reply.sendFile('index.html');
    }
    const body: ApiError = { error: 'Not found', code: 'not_found' };
    return reply.code(404).send(body);
  });

  return app;
}
