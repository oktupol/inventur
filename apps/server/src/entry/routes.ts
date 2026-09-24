import {
  MAX_QUANTITY,
  type CreateEntryRequest,
  type CreateEntryResponse,
  type CreateManualEntryRequest,
  type DeleteEntryResponse,
  type Entry,
  type EntryListResponse,
  type UpdateEntryRequest,
} from '@inventur/shared';
import type { FastifyInstance } from 'fastify';
import type { Context } from '../context.ts';
import { idParams, type IdParams } from '../http/schemas.ts';
import { authenticateRequest } from '../station/routes.ts';
import {
  createEntry,
  createManualEntry,
  deleteEntry,
  listEntries,
  updateEntryQuantity,
} from './service.ts';

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

  app.patch<{ Params: IdParams; Body: UpdateEntryRequest }>(
    '/api/station/entries/:id',
    {
      schema: {
        params: idParams,
        body: {
          oneOf: [
            {
              type: 'object',
              required: ['quantity'],
              properties: { quantity: { type: 'integer', minimum: 1, maximum: MAX_QUANTITY } },
              additionalProperties: false,
            },
            {
              type: 'object',
              required: ['delta'],
              properties: { delta: { type: 'integer', enum: [-1, 1] } },
              additionalProperties: false,
            },
          ],
        },
      },
    },
    async (request): Promise<Entry> =>
      updateEntryQuantity(
        context,
        await authenticateRequest(db, request),
        request.params.id,
        request.body,
      ),
  );

  app.delete<{ Params: IdParams }>(
    '/api/station/entries/:id',
    { schema: { params: idParams } },
    async (request): Promise<DeleteEntryResponse> =>
      deleteEntry(context, await authenticateRequest(db, request), request.params.id),
  );

  app.post<{ Body: CreateManualEntryRequest }>(
    '/api/station/entries/manual',
    {
      schema: {
        body: {
          type: 'object',
          required: ['input', 'description', 'priceGross'],
          properties: {
            input: { type: 'string' },
            description: { type: 'string' },
            priceGross: { type: 'string' },
            serialNumber: { type: ['string', 'null'] },
            requestId: { type: 'string', format: 'uuid' },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply): Promise<Entry> => {
      reply.code(201);
      return createManualEntry(context, await authenticateRequest(db, request), request.body);
    },
  );
}
