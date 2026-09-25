import type { FastifyInstance } from 'fastify';
import type { Context } from '../context.ts';
import { contentDisposition } from '../http/download.ts';
import { idParams, type IdParams } from '../http/schemas.ts';
import { createCountList } from './service.ts';

export async function countListRoutes(app: FastifyInstance, { db }: Context): Promise<void> {
  app.get<{ Params: IdParams; Querystring: { workAreaId?: number } }>(
    '/api/admin/stocktakes/:id/count-list',
    {
      schema: {
        params: idParams,
        querystring: {
          type: 'object',
          properties: { workAreaId: idParams.properties.id },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const { filename, pdf } = await createCountList(
        db,
        request.params.id,
        request.query.workAreaId,
      );
      return reply
        .header('content-type', 'application/pdf')
        .header('content-disposition', contentDisposition(filename))
        .header('cache-control', 'no-store')
        .send(pdf);
    },
  );
}
