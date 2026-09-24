import { randomInt } from 'node:crypto';
import {
  PAIRING_VALIDITY_MS,
  type PairedDevice,
  type PairingOffer,
  type PairRequest,
  type PairResponse,
} from '@inventur/shared';
import bwipjs from 'bwip-js';
import type { Context } from '../context.ts';
import type { Db } from '../db/connection.ts';
import { DomainError } from '../errors.ts';
import { requireActiveStocktake } from '../station/rules.ts';
import { generateToken, type StationIdentity } from '../station/service.ts';
import { getActiveStocktake } from '../stocktake/service.ts';
import { checkRedeemable, deviceLabel, generateCode, normalizeCode } from './rules.ts';

/** A paired phone acts on behalf of its workstation. */
export interface DeviceIdentity {
  pairingId: number;
  workstation: StationIdentity;
}

export function qrSvg(text: string): string {
  return bwipjs.toSVG({ bcid: 'qrcode', text, scale: 4 });
}

/**
 * Creates a code and a QR code with which a phone pairs with the workstation.
 * `origin` is used for the URLs when no public host is configured.
 */
export async function createPairingOffer(
  { db, publicHost }: Context,
  station: StationIdentity,
  origin: { host: string; secure: boolean },
): Promise<PairingOffer> {
  requireActiveStocktake(await getActiveStocktake(db));
  const now = new Date();
  const validUntil = new Date(now.getTime() + PAIRING_VALIDITY_MS);
  const qrToken = generateToken();

  const row = await db.transaction().execute(async (trx) => {
    // Offers that were never used are useless after they expired.
    await trx
      .deleteFrom('inventory.pairing')
      .where('paired_at', 'is', null)
      .where('valid_until', '<', now)
      .execute();
    const active = await trx
      .selectFrom('inventory.pairing')
      .select('one_time_code')
      .where('paired_at', 'is', null)
      .execute();
    const taken = new Set(active.map((p) => p.one_time_code));
    let code = generateCode(randomInt);
    while (taken.has(code)) code = generateCode(randomInt);
    return trx
      .insertInto('inventory.pairing')
      .values({
        workstation_id: station.id,
        one_time_code: code,
        qr_token: qrToken,
        valid_until: validUntil,
      })
      .returning(['id', 'one_time_code'])
      .executeTakeFirstOrThrow();
  });

  const host = publicHost ?? origin.host;
  // Phones need HTTPS for the camera; in development without a public host
  // the origin of the workstation is used as it is.
  const scanUrl = `${publicHost || origin.secure ? 'https' : 'http'}://${host}/scan`;
  const certificateUrl = `http://${host}/zertifikat`;
  return {
    id: row.id,
    code: row.one_time_code,
    scanUrl,
    qrSvg: qrSvg(`${scanUrl}?t=${qrToken}`),
    certificateUrl,
    certificateQrSvg: qrSvg(certificateUrl),
    validUntil: validUntil.toISOString(),
  };
}

/** Pairs a phone with the six-digit code or the token from the QR code; each works once. */
export async function redeemPairing(
  { db, events }: Context,
  request: PairRequest,
  userAgent: string | undefined,
): Promise<PairResponse> {
  if (!request.qrToken && !request.code) {
    throw new DomainError('validation_failed', 'Either code or qrToken is required');
  }
  const deviceToken = generateToken();
  const result = await db.transaction().execute(async (trx) => {
    let query = trx
      .selectFrom('inventory.pairing as p')
      .innerJoin('inventory.workstation as w', 'w.id', 'p.workstation_id')
      .select(['p.id', 'p.valid_until', 'p.paired_at', 'w.id as workstation_id', 'w.name'])
      .forUpdate('p');
    query = request.qrToken
      ? query.where('p.qr_token', '=', request.qrToken)
      : query
          .where('p.one_time_code', '=', normalizeCode(request.code!))
          // A code can repeat among old offers; the newest one counts.
          .orderBy('p.valid_until', 'desc');
    const pairing = await query.executeTakeFirst();
    checkRedeemable(
      pairing && {
        validUntil: new Date(pairing.valid_until),
        pairedAt: pairing.paired_at,
      },
      new Date(),
    );
    await trx
      .updateTable('inventory.pairing')
      .set({
        device_token: deviceToken,
        paired_at: new Date(),
        device_label: deviceLabel(userAgent),
      })
      .where('id', '=', pairing!.id)
      .execute();
    return pairing!;
  });
  events.publish({
    type: 'pairing.changed',
    action: 'created',
    workstationId: result.workstation_id,
    pairingId: result.id,
  });
  return { deviceToken, workstation: { id: result.workstation_id, name: result.name } };
}

/** Resolves the device token of a paired phone; unknown after disconnecting or the end of the stocktake. */
export async function authenticateDevice(
  db: Db,
  token: string | undefined,
): Promise<DeviceIdentity> {
  const row = token
    ? await db
        .selectFrom('inventory.pairing as p')
        .innerJoin('inventory.workstation as w', 'w.id', 'p.workstation_id')
        .select(['p.id', 'w.id as workstation_id', 'w.name'])
        .where('p.device_token', '=', token)
        .executeTakeFirst()
    : undefined;
  if (!row) throw new DomainError('device_unknown', 'Unknown device token');
  return { pairingId: row.id, workstation: { id: row.workstation_id, name: row.name } };
}

export async function listPairedDevices(db: Db, station: StationIdentity): Promise<PairedDevice[]> {
  const rows = await db
    .selectFrom('inventory.pairing')
    .select(['id', 'device_label', 'paired_at'])
    .where('workstation_id', '=', station.id)
    .where('paired_at', 'is not', null)
    .orderBy('paired_at')
    .execute();
  return rows.map((row) => ({
    id: row.id,
    label: row.device_label ?? 'Gerät',
    pairedAt: row.paired_at!.toISOString(),
  }));
}

/** Disconnects a phone or withdraws an unused offer of the workstation. */
export async function deletePairing(
  { db, events }: Context,
  workstationId: number,
  pairingId: number,
): Promise<void> {
  const deleted = await db
    .deleteFrom('inventory.pairing')
    .where('id', '=', pairingId)
    .where('workstation_id', '=', workstationId)
    .returning('paired_at')
    .executeTakeFirst();
  if (!deleted) throw new DomainError('not_found', 'Pairing not found');
  if (deleted.paired_at !== null) {
    events.publish({ type: 'pairing.changed', action: 'deleted', workstationId, pairingId });
  }
}
