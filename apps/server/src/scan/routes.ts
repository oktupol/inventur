import {
  MAX_QUANTITY,
  type CreateEntryRequest,
  type CreateEntryResponse,
  type DeleteEntryResponse,
  type RestoreEntryRequest,
  type RestoreEntryResponse,
  type Entry,
  type UpdateEntryRequest,
} from '@inventur/shared';
import type { FastifyInstance } from 'fastify';
import type { Context } from '../context.ts';
import { restoreBody } from '../entry/routes.ts';
import { createEntry, deleteEntry, restoreEntry, updateEntryQuantity } from '../entry/service.ts';
import { idParams, type IdParams } from '../http/schemas.ts';
import { authenticateDeviceRequest } from '../pairing/routes.ts';

/**
 * Capturing with a paired phone. The phone acts on behalf of its
 * workstation, so scans run through the same logic as keyboard input there.
 */
export async function scanRoutes(app: FastifyInstance, context: Context): Promise<void> {
  const { db, events } = context;

  app.post<{ Body: CreateEntryRequest }>(
    '/api/scan/entries',
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
    async (request): Promise<CreateEntryResponse> => {
      const { workstation } = await authenticateDeviceRequest(db, request);
      const response = await createEntry(context, workstation, request.body);
      events.publish({
        type: 'phone_scan.result',
        workstationId: workstation.id,
        input: request.body.input.trim(),
        result: response.result,
        entryId: response.result === 'unique' ? response.entry.id : null,
        description: response.result === 'unique' ? response.entry.description : null,
        duplicate: response.result === 'unique' && response.entry.duplicateCount > 0,
      });
      return response;
    },
  );

  app.patch<{ Params: IdParams; Body: UpdateEntryRequest }>(
    '/api/scan/entries/:id',
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
    async (request): Promise<Entry> => {
      const { workstation } = await authenticateDeviceRequest(db, request);
      return updateEntryQuantity(
        context,
        { source: 'phone', workstation },
        request.params.id,
        request.body,
      );
    },
  );

  app.delete<{ Params: IdParams }>(
    '/api/scan/entries/:id',
    { schema: { params: idParams } },
    async (request): Promise<DeleteEntryResponse> => {
      const { workstation } = await authenticateDeviceRequest(db, request);
      return deleteEntry(context, { source: 'phone', workstation }, request.params.id);
    },
  );

  app.post<{ Body: RestoreEntryRequest }>(
    '/api/scan/entries/restore',
    { schema: { body: restoreBody } },
    async (request): Promise<RestoreEntryResponse> => {
      const { workstation } = await authenticateDeviceRequest(db, request);
      return restoreEntry(context, { source: 'phone', workstation }, request.body.entryId);
    },
  );
}
