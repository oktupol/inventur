import type { RenameWorkstationRequest, Workstation } from '@inventur/shared';
import type { FastifyInstance } from 'fastify';
import type { Context } from '../context.ts';
import { idParams, nameBody, type IdParams } from '../http/schemas.ts';
import { deleteWorkstation, listWorkstations, renameWorkstation } from './service.ts';

export async function workstationRoutes(app: FastifyInstance, context: Context): Promise<void> {
  app.get('/api/admin/workstations', async (): Promise<Workstation[]> =>
    listWorkstations(context.db),
  );

  app.patch<{ Params: IdParams; Body: RenameWorkstationRequest }>(
    '/api/admin/workstations/:id',
    { schema: { params: idParams, body: nameBody } },
    async (request): Promise<Workstation> =>
      renameWorkstation(context, request.params.id, request.body.name),
  );

  app.delete<{ Params: IdParams }>(
    '/api/admin/workstations/:id',
    { schema: { params: idParams } },
    async (request, reply) => {
      await deleteWorkstation(context, request.params.id);
      return reply.code(204).send();
    },
  );
}
