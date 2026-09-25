import type { MasterDataArticlePage, MasterDataOverview } from '@inventur/shared';
import type { FastifyInstance } from 'fastify';
import type { Context } from '../context.ts';
import { getMasterDataOverview, listMasterDataArticles } from './overview.ts';

export async function masterDataRoutes(app: FastifyInstance, { db }: Context): Promise<void> {
  app.get('/api/admin/master-data/overview', async (): Promise<MasterDataOverview> =>
    getMasterDataOverview(db),
  );

  app.get<{ Querystring: { q?: string; offset?: number } }>(
    '/api/admin/master-data/articles',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            q: { type: 'string', maxLength: 200 },
            offset: { type: 'integer', minimum: 0, maximum: 10_000_000 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request): Promise<MasterDataArticlePage> =>
      listMasterDataArticles(db, request.query.q ?? '', request.query.offset ?? 0),
  );
}
