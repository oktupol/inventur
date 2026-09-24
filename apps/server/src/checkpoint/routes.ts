import type { Checkpoint, CreateCheckpointRequest } from '@inventur/shared';
import type { FastifyInstance } from 'fastify';
import type { Context } from '../context.ts';
import { idParams, type IdParams } from '../http/schemas.ts';
import { authenticateRequest } from '../station/routes.ts';
import { createCheckpoint, deleteCheckpoint } from './service.ts';

export async function checkpointRoutes(app: FastifyInstance, context: Context): Promise<void> {
  const { db } = context;

  app.post<{ Body: CreateCheckpointRequest | undefined }>(
    '/api/station/checkpoints',
    {
      schema: {
        body: {
          type: ['object', 'null'],
          properties: { afterEntryId: idParams.properties.id },
          additionalProperties: false,
        },
      },
    },
    async (request, reply): Promise<Checkpoint> => {
      reply.code(201);
      return createCheckpoint(context, await authenticateRequest(db, request), request.body ?? {});
    },
  );

  app.delete<{ Params: IdParams }>(
    '/api/station/checkpoints/:id',
    { schema: { params: idParams } },
    async (request, reply) => {
      await deleteCheckpoint(context, await authenticateRequest(db, request), request.params.id);
      return reply.code(204).send();
    },
  );
}
