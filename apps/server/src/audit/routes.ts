import { AUDIT_ACTIONS, type AuditLogQuery, type AuditLogResponse } from '@inventur/shared';
import type { FastifyInstance } from 'fastify';
import type { Context } from '../context.ts';
import { idParams, type IdParams } from '../http/schemas.ts';
import { contentDisposition } from '../http/download.ts';
import type { ExportFormat } from '../export/service.ts';
import { exportAuditLog, listAuditLog } from './service.ts';

const filters = {
  workAreaId: idParams.properties.id,
  workstationId: idParams.properties.id,
  action: { type: 'string', enum: AUDIT_ACTIONS },
} as const;

export async function auditRoutes(app: FastifyInstance, { db }: Context): Promise<void> {
  app.get<{ Params: IdParams; Querystring: AuditLogQuery }>(
    '/api/admin/stocktakes/:id/audit-log',
    {
      schema: {
        params: idParams,
        querystring: {
          type: 'object',
          properties: { ...filters, before: idParams.properties.id },
          additionalProperties: false,
        },
      },
    },
    async (request): Promise<AuditLogResponse> =>
      listAuditLog(db, request.params.id, request.query),
  );

  app.get<{ Params: IdParams; Querystring: AuditLogQuery & { format: ExportFormat } }>(
    '/api/admin/stocktakes/:id/audit-log/export',
    {
      schema: {
        params: idParams,
        querystring: {
          type: 'object',
          required: ['format'],
          properties: { ...filters, format: { type: 'string', enum: ['csv', 'xlsx'] } },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const { format, ...query } = request.query;
      const file = await exportAuditLog(db, request.params.id, query, format);
      return reply
        .header('content-type', file.contentType)
        .header('content-disposition', contentDisposition(file.filename))
        .header('cache-control', 'no-store')
        .send(file.body);
    },
  );
}
