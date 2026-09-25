import type { FastifyInstance } from 'fastify';
import type { Context } from '../context.ts';
import { idParams, type IdParams } from '../http/schemas.ts';
import { contentDisposition, createExport, type ExportFormat, type ExportKind } from './service.ts';

interface ExportQuery {
  format: ExportFormat;
  workAreaId?: number;
}

export async function exportRoutes(app: FastifyInstance, { db }: Context): Promise<void> {
  app.get<{ Params: IdParams & { kind: ExportKind }; Querystring: ExportQuery }>(
    '/api/admin/stocktakes/:id/export/:kind',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id', 'kind'],
          properties: {
            ...idParams.properties,
            kind: { type: 'string', enum: ['entries', 'articles', 'reconciliation'] },
          },
        },
        querystring: {
          type: 'object',
          required: ['format'],
          properties: {
            format: { type: 'string', enum: ['csv', 'xlsx'] },
            workAreaId: idParams.properties.id,
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const file = await createExport(db, {
        stocktakeId: request.params.id,
        kind: request.params.kind,
        format: request.query.format,
        workAreaId: request.query.workAreaId,
      });
      return reply
        .header('content-type', file.contentType)
        .header('content-disposition', contentDisposition(file.filename))
        .header('cache-control', 'no-store')
        .send(file.body);
    },
  );
}
