import type { ArticleResolution, ArticleSearchResponse } from '@inventur/shared';
import type { FastifyInstance } from 'fastify';
import type { Context } from '../context.ts';
import { authenticateRequest } from '../station/routes.ts';
import { resolveArticle, searchArticles } from './service.ts';

const queryString = {
  type: 'object',
  required: ['q'],
  properties: { q: { type: 'string', maxLength: 200 } },
} as const;

export async function searchRoutes(app: FastifyInstance, { db }: Context): Promise<void> {
  app.get<{ Querystring: { q: string } }>(
    '/api/station/articles/search',
    { schema: { querystring: queryString } },
    async (request): Promise<ArticleSearchResponse> => {
      await authenticateRequest(db, request);
      return searchArticles(db, request.query.q);
    },
  );

  app.get<{ Querystring: { q: string } }>(
    '/api/station/articles/resolve',
    { schema: { querystring: queryString } },
    async (request): Promise<ArticleResolution> => {
      await authenticateRequest(db, request);
      return resolveArticle(db, request.query.q);
    },
  );
}
