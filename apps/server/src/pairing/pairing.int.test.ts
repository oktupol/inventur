import type { PairedDevice, PairingOffer, PairResponse } from '@inventur/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../test/app.ts';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';

describe('pairing phones', () => {
  let t: TestApp;
  let stocktakeId: number;
  let station: { token: string; id: number };

  beforeAll(async () => {
    t = await createTestApp({ publicHost: '192.168.1.10' });
  });
  afterAll(() => t.close());

  beforeEach(async () => {
    await t.db.deleteFrom('inventory.workstation').execute();
    await t.db.deleteFrom('inventory.stocktake').execute();
    stocktakeId = (
      await t.app.inject({ method: 'POST', url: '/api/admin/stocktakes', payload: { name: 'I' } })
    ).json().id;
    station = await register('Kasse');
    t.takeEvents();
  });

  async function register(name: string) {
    const response = await t.app.inject({
      method: 'POST',
      url: '/api/station/register',
      payload: { name },
    });
    return { token: response.json().token as string, id: response.json().workstation.id as number };
  }

  const stationRequest = (method: 'GET' | 'POST' | 'DELETE', url: string, token = station.token) =>
    t.app.inject({ method, url, headers: { 'x-workstation-token': token } });

  async function offer(token = station.token): Promise<PairingOffer> {
    const response = await stationRequest('POST', '/api/station/pairings', token);
    expect(response.statusCode, response.body).toBe(201);
    return response.json();
  }

  const pair = (payload: object) =>
    t.app.inject({
      method: 'POST',
      url: '/api/scan/pair',
      payload,
      headers: { 'user-agent': IPHONE },
    });

  const scanMe = (deviceToken: string) =>
    t.app.inject({
      method: 'GET',
      url: '/api/scan/me',
      headers: { 'x-device-token': deviceToken },
    });

  const devices = async (token = station.token): Promise<PairedDevice[]> =>
    (await stationRequest('GET', '/api/station/pairings', token)).json();

  it('offers a six-digit code and a QR code for the public host', async () => {
    const created = await offer();
    expect(created.code).toMatch(/^\d{6}$/);
    expect(created.scanUrl).toBe('https://192.168.1.10/scan');
    expect(created.certificateUrl).toBe('http://192.168.1.10/zertifikat');
    expect(created.qrSvg).toMatch(/^<svg/);
    expect(created.certificateQrSvg).toMatch(/^<svg/);
    const minutes = (new Date(created.validUntil).getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(4.9);
    expect(minutes).toBeLessThanOrEqual(5);
  });

  it('pairs a phone with the code; the pairing survives as a device token', async () => {
    const { code, id } = await offer();
    const response = await pair({ code: `${code.slice(0, 3)} ${code.slice(3)}` });
    expect(response.statusCode).toBe(200);
    const paired: PairResponse = response.json();
    expect(paired.workstation).toEqual({ id: station.id, name: 'Kasse' });
    expect(paired.deviceToken).toMatch(/^[\w-]{43}$/);

    const me = await scanMe(paired.deviceToken);
    expect(me.json()).toMatchObject({
      workstation: { name: 'Kasse' },
      stocktake: { id: stocktakeId },
    });
    expect(await devices()).toEqual([{ id, label: 'iPhone', pairedAt: expect.any(String) }]);
    expect(t.takeEvents()).toEqual([
      { type: 'pairing.changed', action: 'created', workstationId: station.id, pairingId: id },
    ]);
  });

  it('pairs a phone with the token from the QR code', async () => {
    const created = await offer();
    // The QR code contains the URL with the token; read the token from the database.
    const { qr_token } = await t.db
      .selectFrom('inventory.pairing')
      .select('qr_token')
      .where('id', '=', created.id)
      .executeTakeFirstOrThrow();
    const response = await pair({ qrToken: qr_token });
    expect(response.statusCode).toBe(200);
  });

  it('accepts a code only once', async () => {
    const { code } = await offer();
    expect((await pair({ code })).statusCode).toBe(200);
    const again = await pair({ code });
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe('pairing_used');
  });

  it('rejects an expired code', async () => {
    const { code, id } = await offer();
    await t.db
      .updateTable('inventory.pairing')
      .set({ valid_until: new Date(Date.now() - 1000) })
      .where('id', '=', id)
      .execute();
    const response = await pair({ code });
    expect(response.statusCode).toBe(410);
    expect(response.json().code).toBe('pairing_expired');
  });

  it('rejects unknown and malformed codes', async () => {
    await offer();
    const unknown = await pair({ code: '000000' });
    // 000000 could be the offered code in one of a million runs.
    expect([200, 404]).toContain(unknown.statusCode);
    expect((await pair({ qrToken: 'nope' })).json().code).toBe('pairing_invalid');
    expect((await pair({ code: '12ab56' })).json().code).toBe('validation_failed');
    expect((await pair({})).json().code).toBe('validation_failed');
  });

  it('allows several phones per workstation', async () => {
    await pair({ code: (await offer()).code });
    await pair({ code: (await offer()).code });
    expect(await devices()).toHaveLength(2);
  });

  it('gives concurrent offers distinct codes', async () => {
    const offers = await Promise.all(Array.from({ length: 20 }, () => offer()));
    expect(new Set(offers.map((o) => o.code)).size).toBe(20);
  });

  it('is disconnected by the workstation', async () => {
    const { code, id } = await offer();
    const { deviceToken } = (await pair({ code })).json();
    t.takeEvents();
    expect((await stationRequest('DELETE', `/api/station/pairings/${id}`)).statusCode).toBe(204);
    const me = await scanMe(deviceToken);
    expect(me.statusCode).toBe(401);
    expect(me.json().code).toBe('device_unknown');
    expect(t.takeEvents()).toEqual([
      { type: 'pairing.changed', action: 'deleted', workstationId: station.id, pairingId: id },
    ]);
  });

  it('is disconnected by the phone', async () => {
    const { code } = await offer();
    const { deviceToken } = (await pair({ code })).json();
    const response = await t.app.inject({
      method: 'DELETE',
      url: '/api/scan/pairing',
      headers: { 'x-device-token': deviceToken },
    });
    expect(response.statusCode).toBe(204);
    expect(await devices()).toEqual([]);
  });

  it('withdraws an unused offer without an event', async () => {
    const { id, code } = await offer();
    expect((await stationRequest('DELETE', `/api/station/pairings/${id}`)).statusCode).toBe(204);
    expect(t.takeEvents()).toEqual([]);
    expect((await pair({ code })).json().code).toBe('pairing_invalid');
  });

  it('cannot disconnect pairings of other workstations', async () => {
    const other = await register('Lager');
    const { id } = await offer(other.token);
    expect((await stationRequest('DELETE', `/api/station/pairings/${id}`)).statusCode).toBe(404);
  });

  it('ends all pairings when the stocktake is finished', async () => {
    const { deviceToken } = (await pair({ code: (await offer()).code })).json();
    await t.app.inject({
      method: 'POST',
      url: `/api/admin/stocktakes/${stocktakeId}/finish`,
      payload: { confirm: true },
    });
    expect((await scanMe(deviceToken)).statusCode).toBe(401);
    const response = await stationRequest('POST', '/api/station/pairings');
    expect(response.json().code).toBe('no_active_stocktake');
  });
});

describe('pairing without a public host', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('uses the host of the request', async () => {
    await t.app.inject({ method: 'POST', url: '/api/admin/stocktakes', payload: { name: 'I' } });
    const { token } = (
      await t.app.inject({ method: 'POST', url: '/api/station/register', payload: { name: 'K' } })
    ).json();
    const offer: PairingOffer = (
      await t.app.inject({
        method: 'POST',
        url: '/api/station/pairings',
        headers: { 'x-workstation-token': token, host: 'inventur.local:5173' },
      })
    ).json();
    expect(offer.scanUrl).toBe('http://inventur.local:5173/scan');
    expect(offer.certificateUrl).toBe('http://inventur.local:5173/zertifikat');
  });
});
