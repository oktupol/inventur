import {
  DEVICE_TOKEN_HEADER,
  type PairedDevice,
  type PairingOffer,
  type PairRequest,
  type PairResponse,
  type StationState,
} from '@inventur/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Context } from '../context.ts';
import type { Db } from '../db/connection.ts';
import { idParams, type IdParams } from '../http/schemas.ts';
import { authenticateRequest } from '../station/routes.ts';
import { getStationState } from '../station/service.ts';
import {
  authenticateDevice,
  createPairingOffer,
  deletePairing,
  listPairedDevices,
  redeemPairing,
  type DeviceIdentity,
} from './service.ts';

/** Authenticates a request of a paired phone by its token header. */
export function authenticateDeviceRequest(
  db: Db,
  request: FastifyRequest,
): Promise<DeviceIdentity> {
  const token = request.headers[DEVICE_TOKEN_HEADER];
  return authenticateDevice(db, typeof token === 'string' ? token : undefined);
}

export async function pairingRoutes(app: FastifyInstance, context: Context): Promise<void> {
  const { db } = context;

  // Workstation side
  app.post('/api/station/pairings', async (request, reply): Promise<PairingOffer> => {
    const station = await authenticateRequest(db, request);
    const forwarded = request.headers['x-forwarded-proto'];
    reply.code(201);
    return createPairingOffer(context, station, {
      host: request.host,
      secure: request.protocol === 'https' || forwarded === 'https',
    });
  });

  app.get('/api/station/pairings', async (request): Promise<PairedDevice[]> =>
    listPairedDevices(db, await authenticateRequest(db, request)),
  );

  app.delete<{ Params: IdParams }>(
    '/api/station/pairings/:id',
    { schema: { params: idParams } },
    async (request, reply) => {
      const station = await authenticateRequest(db, request);
      await deletePairing(context, station.id, request.params.id);
      return reply.code(204).send();
    },
  );

  // Phone side
  app.post<{ Body: PairRequest }>(
    '/api/scan/pair',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            code: { type: 'string', maxLength: 20 },
            qrToken: { type: 'string', maxLength: 100 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request): Promise<PairResponse> =>
      redeemPairing(context, request.body, request.headers['user-agent']),
  );

  app.get('/api/scan/me', async (request): Promise<StationState> => {
    const device = await authenticateDeviceRequest(db, request);
    return getStationState(db, device.workstation);
  });

  app.delete('/api/scan/pairing', async (request, reply) => {
    const device = await authenticateDeviceRequest(db, request);
    await deletePairing(context, device.workstation.id, device.pairingId);
    return reply.code(204).send();
  });
}
