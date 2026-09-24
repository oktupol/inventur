import type {
  CreateWorkAreaRequest,
  ImportResponse,
  UpdateWorkAreaRequest,
  WorkArea,
} from '@inventur/shared';
import type { FastifyInstance } from 'fastify';
import type { Context } from '../context.ts';
import { idParams, itemParams, type IdParams, type ItemParams } from '../http/schemas.ts';
import { getStocktake } from '../stocktake/service.ts';
import {
  createWorkArea,
  deleteWorkArea,
  importWorkAreas,
  listWorkAreas,
  updateWorkArea,
} from './service.ts';
import { closeWorkArea, reopenWorkArea } from './transitions.ts';

const description = { type: ['string', 'null'] } as const;

export async function workAreaRoutes(app: FastifyInstance, context: Context): Promise<void> {
  const { db } = context;

  app.get<{ Params: IdParams }>(
    '/api/admin/stocktakes/:id/work-areas',
    { schema: { params: idParams } },
    async (request): Promise<WorkArea[]> => {
      await getStocktake(db, request.params.id);
      return listWorkAreas(db, request.params.id);
    },
  );

  app.post<{ Params: IdParams; Body: CreateWorkAreaRequest }>(
    '/api/admin/stocktakes/:id/work-areas',
    {
      schema: {
        params: idParams,
        body: {
          type: 'object',
          required: ['name'],
          properties: { name: { type: 'string' }, description },
          additionalProperties: false,
        },
      },
    },
    async (request, reply): Promise<WorkArea> => {
      reply.code(201);
      return createWorkArea(context, request.params.id, request.body);
    },
  );

  app.post<{ Params: IdParams }>(
    '/api/admin/stocktakes/:id/work-areas/import',
    { schema: { params: idParams } },
    async (request): Promise<ImportResponse<WorkArea>> =>
      importWorkAreas(context, request.params.id),
  );

  app.patch<{ Params: ItemParams; Body: UpdateWorkAreaRequest }>(
    '/api/admin/stocktakes/:id/work-areas/:itemId',
    {
      schema: {
        params: itemParams,
        body: {
          type: 'object',
          properties: { name: { type: 'string' }, description },
          additionalProperties: false,
        },
      },
    },
    async (request): Promise<WorkArea> =>
      updateWorkArea(context, request.params.id, request.params.itemId, request.body),
  );

  app.delete<{ Params: ItemParams }>(
    '/api/admin/stocktakes/:id/work-areas/:itemId',
    { schema: { params: itemParams } },
    async (request, reply) => {
      await deleteWorkArea(context, request.params.id, request.params.itemId);
      return reply.code(204).send();
    },
  );

  app.post<{ Params: ItemParams }>(
    '/api/admin/stocktakes/:id/work-areas/:itemId/close',
    { schema: { params: itemParams } },
    async (request, reply) => {
      await closeWorkArea(context, request.params.id, request.params.itemId);
      return reply.code(204).send();
    },
  );

  app.post<{ Params: ItemParams }>(
    '/api/admin/stocktakes/:id/work-areas/:itemId/reopen',
    { schema: { params: itemParams } },
    async (request, reply) => {
      await reopenWorkArea(context, request.params.id, request.params.itemId);
      return reply.code(204).send();
    },
  );
}
