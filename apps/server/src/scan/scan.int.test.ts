import type { CreateEntryResponse, EntryListResponse } from '@inventur/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../test/app.ts';

describe('capturing with a paired phone', () => {
  let t: TestApp;
  let station: { token: string; id: number };
  let device: string;
  let anna: number;
  let workAreaId: number;

  beforeAll(async () => {
    t = await createTestApp({ publicHost: '192.168.1.10' });
    await t.db
      .insertInto('master_data.article')
      .values([
        {
          id: 1,
          description: 'Ring',
          ean: '4000000000017',
          price_net: '10.00',
          price_gross: '11.90',
          category: 'Ringe',
        },
        {
          id: 2,
          description: 'Kette',
          ean: '4000000000031',
          price_net: '10.00',
          price_gross: '11.90',
          category: 'Ketten',
        },
        {
          id: 3,
          description: 'Kette lang',
          ean: '4000000000031',
          price_net: '20.00',
          price_gross: '23.80',
          category: 'Ketten',
        },
      ])
      .execute();
  });
  afterAll(() => t.close());

  beforeEach(async () => {
    await t.db.deleteFrom('inventory.entry').execute();
    await t.db.deleteFrom('inventory.workstation').execute();
    await t.db.deleteFrom('inventory.stocktake').execute();
    const stocktakeId = (await post('/api/admin/stocktakes', { name: 'I' })).json().id;
    workAreaId = (
      await post(`/api/admin/stocktakes/${stocktakeId}/work-areas`, { name: 'V' })
    ).json().id;
    const registered = (await post('/api/station/register', { name: 'Kasse' })).json();
    station = { token: registered.token, id: registered.workstation.id };
    anna = (await post(`/api/admin/stocktakes/${stocktakeId}/employees`, { name: 'Anna' })).json()
      .id;
    await post(
      `/api/station/employees/${anna}/login`,
      {},
      { 'x-workstation-token': station.token },
    );
    await post(
      `/api/station/work-areas/${workAreaId}/join`,
      {},
      { 'x-workstation-token': station.token },
    );
    const offer = (
      await post('/api/station/pairings', {}, { 'x-workstation-token': station.token })
    ).json();
    device = (await post('/api/scan/pair', { code: offer.code })).json().deviceToken;
    t.takeEvents();
  });

  function post(url: string, payload: object, headers: Record<string, string> = {}) {
    return t.app.inject({ method: 'POST', url, payload, headers });
  }

  const scan = async (payload: object): Promise<CreateEntryResponse> => {
    const response = await post('/api/scan/entries', payload, { 'x-device-token': device });
    expect(response.statusCode, response.body).toBe(200);
    return response.json();
  };

  const stationList = async (): Promise<EntryListResponse> =>
    (
      await t.app.inject({
        method: 'GET',
        url: '/api/station/entries',
        headers: { 'x-workstation-token': station.token },
      })
    ).json();

  it('creates the line at the paired workstation and tells the workstation', async () => {
    const response = await scan({ input: '4000000000017' });
    expect(response).toMatchObject({ result: 'unique', entry: { description: 'Ring' } });
    const entryId = (response as { entry: { id: number } }).entry.id;
    const { entries } = await stationList();
    expect(entries.map((e) => [e.id, e.workstation.name])).toEqual([[entryId, 'Kasse']]);
    expect(t.takeEvents()).toContainEqual({
      type: 'phone_scan.result',
      workstationId: station.id,
      input: '4000000000017',
      result: 'unique',
      entryId,
      description: 'Ring',
      duplicate: false,
    });
  });

  it('tells the workstation about a repeated article', async () => {
    await scan({ input: '4000000000017' });
    await scan({ input: '4000000000017' });
    expect(
      t
        .takeEvents()
        .filter((e) => e.type === 'phone_scan.result')
        .map((e) => 'duplicate' in e && e.duplicate),
    ).toEqual([false, true]);
  });

  it('returns choices and unknown codes like the keyboard input', async () => {
    const ambiguous = await scan({ input: '4000000000031' });
    expect(ambiguous.result).toBe('ambiguous');
    const chosen = await scan({ input: '4000000000031', articleId: 3 });
    expect(chosen).toMatchObject({ result: 'unique', entry: { articleId: 3 } });
    expect(await scan({ input: '4099999999994' })).toEqual({ result: 'not_found' });
    expect(
      t
        .takeEvents()
        .filter((e) => e.type === 'phone_scan.result')
        .map((e) => 'result' in e && e.result),
    ).toEqual(['ambiguous', 'unique', 'not_found']);
  });

  it('changes and deletes the scanned line from the phone', async () => {
    const response = await scan({ input: '4000000000017' });
    const entryId = (response as { entry: { id: number } }).entry.id;
    const headers = { 'x-device-token': device };
    const plus = await t.app.inject({
      method: 'PATCH',
      url: `/api/scan/entries/${entryId}`,
      payload: { delta: 1 },
      headers,
    });
    expect(plus.json().quantity).toBe(2);
    const minus = await t.app.inject({
      method: 'PATCH',
      url: `/api/scan/entries/${entryId}`,
      payload: { delta: -1 },
      headers,
    });
    expect(minus.json().quantity).toBe(1);
    const deleted = await t.app.inject({
      method: 'DELETE',
      url: `/api/scan/entries/${entryId}`,
      headers,
    });
    expect(deleted.json()).toEqual({ removedCheckpoints: [] });
    expect((await stationList()).entries).toEqual([]);
  });

  it('needs the same preconditions as the workstation', async () => {
    await post(
      `/api/station/employees/${anna}/logout`,
      {},
      { 'x-workstation-token': station.token },
    );
    const response = await post(
      '/api/scan/entries',
      { input: '4000000000017' },
      { 'x-device-token': device },
    );
    expect(response.json().code).toBe('no_employee_logged_in');
  });

  it('requires a paired device', async () => {
    const response = await post(
      '/api/scan/entries',
      { input: '4000000000017' },
      { 'x-device-token': 'x' },
    );
    expect(response.statusCode).toBe(401);
  });
});
