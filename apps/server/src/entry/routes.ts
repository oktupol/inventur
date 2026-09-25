import {
  MAX_QUANTITY,
  type CreateEntryRequest,
  type CreateEntryResponse,
  type CreateManualEntryRequest,
  type DeleteEntryResponse,
  type RestoreEntryRequest,
  type RestoreEntryResponse,
  type UpdateSerialNumberRequest,
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
  restoreEntry,
  updateSerialNumber,
  updateEntryQuantity,
} from './service.ts';

/** JSON schema of `RestoreEntryRequest`. */
export const restoreBody = {
  type: 'object',
  required: ['entryId'],
  properties: { entryId: idParams.properties.id },
  additionalProperties: false,
} as const;

/** JSON schema of `UpdateSerialNumberRequest`; `parseSerialNumber` checks the length. */
export const serialNumberBody = {
  type: 'object',
  required: ['serialNumber'],
  properties: { serialNumber: { type: ['string', 'null'] } },
  additionalProperties: false,
} as const;

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
        { source: 'station', workstation: await authenticateRequest(db, request) },
        request.params.id,
        request.body,
      ),
  );

  app.delete<{ Params: IdParams }>(
    '/api/station/entries/:id',
    { schema: { params: idParams } },
    async (request): Promise<DeleteEntryResponse> =>
      deleteEntry(
        context,
        { source: 'station', workstation: await authenticateRequest(db, request) },
        request.params.id,
      ),
  );

  app.put<{ Params: IdParams; Body: UpdateSerialNumberRequest }>(
    '/api/station/entries/:id/serial-number',
    { schema: { params: idParams, body: serialNumberBody } },
    async (request): Promise<Entry> =>
      updateSerialNumber(
        context,
        { source: 'station', workstation: await authenticateRequest(db, request) },
        request.params.id,
        request.body.serialNumber,
      ),
  );

  app.post<{ Body: RestoreEntryRequest }>(
    '/api/station/entries/restore',
    { schema: { body: restoreBody } },
    async (request): Promise<RestoreEntryResponse> =>
      restoreEntry(
        context,
        { source: 'station', workstation: await authenticateRequest(db, request) },
        request.body.entryId,
      ),
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
