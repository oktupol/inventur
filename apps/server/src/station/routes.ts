import {
  WORKSTATION_TOKEN_HEADER,
  type NamedRef,
  type RegisterWorkstationRequest,
  type StationEmployee,
  type StationState,
  type TakeOverWorkstationRequest,
  type WorkArea,
  type WorkstationRegistration,
} from '@inventur/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Context } from '../context.ts';
import { idParams, nameBody, type IdParams } from '../http/schemas.ts';
import { getActiveStocktake } from '../stocktake/service.ts';
import { listWorkAreas } from '../work-area/service.ts';
import {
  closeWorkArea,
  joinWorkArea,
  leaveWorkArea,
  reopenWorkArea,
} from '../work-area/transitions.ts';
import { requireActiveStocktake } from './rules.ts';
import {
  authenticate,
  getStationState,
  listStationEmployees,
  listWorkstationNames,
  loginEmployee,
  logoutEmployeeAtStation,
  registerWorkstation,
  takeOverWorkstation,
  type StationIdentity,
} from './service.ts';

/** API for the workstations; all but registration require the workstation token. */
export async function stationRoutes(app: FastifyInstance, context: Context): Promise<void> {
  const { db } = context;

  const station = (request: FastifyRequest): Promise<StationIdentity> => {
    const token = request.headers[WORKSTATION_TOKEN_HEADER];
    return authenticate(db, typeof token === 'string' ? token : undefined);
  };

  app.post<{ Body: RegisterWorkstationRequest }>(
    '/api/station/register',
    { schema: { body: nameBody } },
    async (request, reply): Promise<WorkstationRegistration> => {
      reply.code(201);
      return registerWorkstation(context, request.body.name);
    },
  );

  app.get('/api/station/workstations', async (): Promise<NamedRef[]> => listWorkstationNames(db));

  app.post<{ Body: TakeOverWorkstationRequest }>(
    '/api/station/take-over',
    {
      schema: {
        body: {
          type: 'object',
          required: ['workstationId'],
          properties: { workstationId: idParams.properties.id },
          additionalProperties: false,
        },
      },
    },
    async (request): Promise<WorkstationRegistration> =>
      takeOverWorkstation(context, request.body.workstationId),
  );

  app.get('/api/station/me', async (request): Promise<StationState> =>
    getStationState(db, await station(request)),
  );

  app.get('/api/station/employees', async (request): Promise<StationEmployee[]> => {
    await station(request);
    return listStationEmployees(db);
  });

  app.post<{ Params: IdParams }>(
    '/api/station/employees/:id/login',
    { schema: { params: idParams } },
    async (request): Promise<StationState> => {
      const identity = await station(request);
      await loginEmployee(context, identity, request.params.id);
      return getStationState(db, identity);
    },
  );

  app.post<{ Params: IdParams }>(
    '/api/station/employees/:id/logout',
    { schema: { params: idParams } },
    async (request): Promise<StationState> => {
      const identity = await station(request);
      await logoutEmployeeAtStation(context, identity, request.params.id);
      return getStationState(db, identity);
    },
  );

  app.get('/api/station/work-areas', async (request): Promise<WorkArea[]> => {
    await station(request);
    const stocktake = requireActiveStocktake(await getActiveStocktake(db));
    return listWorkAreas(db, stocktake.id);
  });

  app.post<{ Params: IdParams }>(
    '/api/station/work-areas/:id/join',
    { schema: { params: idParams } },
    async (request): Promise<StationState> => {
      const identity = await station(request);
      await joinWorkArea(context, identity, request.params.id);
      return getStationState(db, identity);
    },
  );

  app.post('/api/station/work-area/leave', async (request): Promise<StationState> => {
    const identity = await station(request);
    await leaveWorkArea(context, identity);
    return getStationState(db, identity);
  });

  for (const [action, transition] of [
    ['close', closeWorkArea],
    ['reopen', reopenWorkArea],
  ] as const) {
    app.post<{ Params: IdParams }>(
      `/api/station/work-areas/:id/${action}`,
      { schema: { params: idParams } },
      async (request): Promise<StationState> => {
        const identity = await station(request);
        const stocktake = requireActiveStocktake(await getActiveStocktake(db));
        await transition(context, stocktake.id, request.params.id, identity);
        return getStationState(db, identity);
      },
    );
  }
}
