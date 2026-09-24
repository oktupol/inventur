import type { CreateEntryRequest, CreateEntryResponse, EntryListResponse } from '@inventur/shared';
import type { FastifyInstance } from 'fastify';
import type { Context } from '../context.ts';
import { idParams } from '../http/schemas.ts';
import { authenticateRequest } from '../station/routes.ts';
import { createEntry, listEntries } from './service.ts';

export async function entryRoutes(app: FastifyInstance, context: Context): Promise<void> {
  const { db } = context;

  app.get('/api/station/entries', async (request): Promise<EntryListResponse> =>
    listEntries(db, await authenticateRequest(db, request)),
  );

  app.post<{ Body: CreateEntryRequest }>(
    '/api/station/entries',
    {
      schema: {
        body: {
          type: 'object',
          required: ['input'],
          properties: {
            input: { type: 'string' },
            articleId: idParams.properties.id,
            requestId: { type: 'string', format: 'uuid' },
          },
          additionalProperties: false,
        },
      },
    },
    async (request): Promise<CreateEntryResponse> =>
      createEntry(context, await authenticateRequest(db, request), request.body),
  );
}
