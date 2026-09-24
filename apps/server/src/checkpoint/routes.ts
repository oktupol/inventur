import type { Checkpoint } from '@inventur/shared';
import type { FastifyInstance } from 'fastify';
import type { Context } from '../context.ts';
import { authenticateRequest } from '../station/routes.ts';
import { createCheckpoint } from './service.ts';

export async function checkpointRoutes(app: FastifyInstance, context: Context): Promise<void> {
  app.post('/api/station/checkpoints', async (request, reply): Promise<Checkpoint> => {
    reply.code(201);
    return createCheckpoint(context, await authenticateRequest(context.db, request));
  });
}
