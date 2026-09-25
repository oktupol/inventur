import type { StocktakeArticleDetail, StocktakeArticleSearchResponse } from '@inventur/shared';
import type { FastifyInstance } from 'fastify';
import type { Context } from '../context.ts';
import { idParams, itemParams, type IdParams, type ItemParams } from '../http/schemas.ts';
import { getStocktakeArticle, searchStocktakeArticles } from './service.ts';

export async function articleSearchRoutes(app: FastifyInstance, { db }: Context): Promise<void> {
  app.get<{ Params: IdParams; Querystring: { q: string } }>(
    '/api/admin/stocktakes/:id/articles/search',
    {
      schema: {
        params: idParams,
        querystring: {
          type: 'object',
          required: ['q'],
          properties: { q: { type: 'string', maxLength: 200 } },
        },
      },
    },
    async (request): Promise<StocktakeArticleSearchResponse> =>
      searchStocktakeArticles(db, request.params.id, request.query.q),
  );

  app.get<{ Params: ItemParams }>(
    '/api/admin/stocktakes/:id/articles/:itemId',
    { schema: { params: itemParams } },
    async (request): Promise<StocktakeArticleDetail> =>
      getStocktakeArticle(db, request.params.id, request.params.itemId),
  );
}
