import type {
  ActiveStocktakeResponse,
  FinishStocktakeRequest,
  StartStocktakeRequest,
  Stocktake,
  StocktakeSummary,
} from '@inventur/shared';
import type { FastifyInstance } from 'fastify';
import type { Context } from '../context.ts';
import { idParams, nameBody, type IdParams } from '../http/schemas.ts';
import {
  finishStocktake,
  getActiveStocktake,
  getStocktake,
  listStocktakes,
  startStocktake,
} from './service.ts';

export async function stocktakeRoutes(app: FastifyInstance, context: Context): Promise<void> {
  const { db } = context;

  app.get('/api/stocktakes', async (): Promise<StocktakeSummary[]> => listStocktakes(db));

  app.get('/api/stocktakes/active', async (): Promise<ActiveStocktakeResponse> => ({
    stocktake: await getActiveStocktake(db),
  }));

  app.get<{ Params: IdParams }>(
    '/api/stocktakes/:id',
    { schema: { params: idParams } },
    async (request): Promise<Stocktake> => getStocktake(db, request.params.id),
  );

  app.post<{ Body: StartStocktakeRequest }>(
    '/api/stocktakes',
    {
      schema: { body: nameBody },
    },
    async (request, reply): Promise<Stocktake> => {
      reply.code(201);
      return startStocktake(context, request.body.name);
    },
  );

  app.post<{ Params: IdParams; Body: FinishStocktakeRequest | undefined }>(
    '/api/stocktakes/:id/finish',
    {
      schema: {
        params: idParams,
        body: {
          type: ['object', 'null'],
          properties: { confirm: { type: 'boolean' } },
          additionalProperties: false,
        },
      },
    },
    async (request): Promise<Stocktake> =>
      finishStocktake(context, request.params.id, request.body?.confirm === true),
  );
}
