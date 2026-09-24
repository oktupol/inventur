import type { CreateEmployeeRequest, Employee, ImportResponse } from '@inventur/shared';
import type { FastifyInstance } from 'fastify';
import type { Context } from '../context.ts';
import { idParams, itemParams, nameBody, type IdParams, type ItemParams } from '../http/schemas.ts';
import { getStocktake } from '../stocktake/service.ts';
import {
  createEmployee,
  deleteEmployee,
  importEmployees,
  listEmployees,
  logoutEmployee,
} from './service.ts';

export async function employeeRoutes(app: FastifyInstance, context: Context): Promise<void> {
  const { db } = context;

  app.get<{ Params: IdParams }>(
    '/api/admin/stocktakes/:id/employees',
    { schema: { params: idParams } },
    async (request): Promise<Employee[]> => {
      await getStocktake(db, request.params.id);
      return listEmployees(db, request.params.id);
    },
  );

  app.post<{ Params: IdParams; Body: CreateEmployeeRequest }>(
    '/api/admin/stocktakes/:id/employees',
    { schema: { params: idParams, body: nameBody } },
    async (request, reply): Promise<Employee> => {
      reply.code(201);
      return createEmployee(context, request.params.id, request.body.name);
    },
  );

  app.post<{ Params: IdParams }>(
    '/api/admin/stocktakes/:id/employees/import',
    { schema: { params: idParams } },
    async (request): Promise<ImportResponse<Employee>> =>
      importEmployees(context, request.params.id),
  );

  app.delete<{ Params: ItemParams }>(
    '/api/admin/stocktakes/:id/employees/:itemId',
    { schema: { params: itemParams } },
    async (request, reply) => {
      await deleteEmployee(context, request.params.id, request.params.itemId);
      return reply.code(204).send();
    },
  );

  app.post<{ Params: ItemParams }>(
    '/api/admin/stocktakes/:id/employees/:itemId/logout',
    { schema: { params: itemParams } },
    async (request): Promise<Employee> =>
      logoutEmployee(context, request.params.id, request.params.itemId),
  );
}
