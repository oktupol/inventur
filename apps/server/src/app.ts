import Fastify, { type FastifyInstance } from 'fastify';
import type { HealthResponse } from '@inventur/shared';
import type { Config } from './config.ts';

export async function buildApp(config: Pick<Config, 'version'>): Promise<FastifyInstance> {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' });

  app.get('/api/health', async (): Promise<HealthResponse> => {
    return { status: 'ok', version: config.version };
  });

  return app;
}
