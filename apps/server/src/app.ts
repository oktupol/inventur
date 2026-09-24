import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import type { HealthResponse } from '@inventur/shared';
import type { Config } from './config.ts';

export type AppOptions = Pick<Config, 'version'> & Partial<Pick<Config, 'staticDir'>>;

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' });

  // Der Docker-Healthcheck fragt alle 10 Sekunden ab, daher ohne Request-Log.
  app.get('/api/health', { logLevel: 'warn' }, async (): Promise<HealthResponse> => {
    return { status: 'ok', version: options.version };
  });

  if (options.staticDir) {
    await app.register(fastifyStatic, { root: options.staticDir, wildcard: false });
  }

  app.setNotFoundHandler((request, reply) => {
    const isApi = request.url === '/api' || request.url.startsWith('/api/');
    if (options.staticDir && request.method === 'GET' && !isApi) {
      // Single-Page-App: unbekannte Pfade wie /admin oder /scan liefern index.html.
      return reply.sendFile('index.html');
    }
    return reply.code(404).send({ fehler: 'Nicht gefunden' });
  });

  return app;
}
