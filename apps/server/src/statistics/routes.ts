import type { Reconciliation, StocktakeStatistics } from '@inventur/shared';
import type { FastifyInstance } from 'fastify';
import type { Context } from '../context.ts';
import { idParams, type IdParams } from '../http/schemas.ts';
import { getReconciliation, getStatistics } from './service.ts';

export async function statisticsRoutes(app: FastifyInstance, { db }: Context): Promise<void> {
  app.get<{ Params: IdParams }>(
    '/api/admin/stocktakes/:id/statistics',
    { schema: { params: idParams } },
    async (request): Promise<StocktakeStatistics> => getStatistics(db, request.params.id),
  );

  app.get<{ Params: IdParams }>(
    '/api/admin/stocktakes/:id/reconciliation',
    { schema: { params: idParams } },
    async (request): Promise<Reconciliation> => getReconciliation(db, request.params.id),
  );
}
