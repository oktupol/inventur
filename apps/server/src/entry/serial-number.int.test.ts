import type { AuditLogResponse, CreateEntryResponse, Entry } from '@inventur/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../test/app.ts';

describe('serial numbers of lines', () => {
  let t: TestApp;
  let stocktakeId: number;
  let workAreaId: number;
  let kasse: Record<string, string>;

  beforeAll(async () => {
    t = await createTestApp({ publicHost: '192.168.1.10' });
    await t.db
      .insertInto('master_data.article')
      .values({
        id: 1,
        description: 'Herrenuhr',
        ean: '4000000000017',
        price_net: '100.00',
        price_gross: '119.00',
        category: 'Uhren',
      })
      .execute();
  });
  afterAll(() => t.close());

  beforeEach(async () => {
    await t.db.deleteFrom('inventory.entry').execute();
    await t.db.deleteFrom('inventory.workstation').execute();
    await t.db.deleteFrom('inventory.stocktake').execute();
    stocktakeId = (await post('/api/admin/stocktakes', { name: 'Inventur' })).json().id;
    workAreaId = (
      await post(`/api/admin/stocktakes/${stocktakeId}/work-areas`, { name: 'Vitrine 1' })
    ).json().id;
    const { token } = (await post('/api/station/register', { name: 'Kasse' })).json();
    kasse = { 'x-workstation-token': token };
    const anna = (
      await post(`/api/admin/stocktakes/${stocktakeId}/employees`, { name: 'Anna' })
    ).json().id;
    await post(`/api/station/employees/${anna}/login`, {}, kasse);
    await post(`/api/station/work-areas/${workAreaId}/join`, {}, kasse);
  });

  function post(url: string, payload: object, headers: Record<string, string> = {}) {
    return t.app.inject({ method: 'POST', url, payload, headers });
  }

  async function capture(): Promise<Entry> {
    const body = (
      await post('/api/station/entries', { input: '4000000000017' }, kasse)
    ).json<CreateEntryResponse>();
    if (body.result !== 'unique') throw new Error('not captured');
    return body.entry;
  }

  const setSerial = (
    entryId: number,
    serialNumber: string | null,
    headers = kasse,
    base = '/api/station',
  ) =>
    t.app.inject({
      method: 'PUT',
      url: `${base}/entries/${entryId}/serial-number`,
      payload: { serialNumber },
      headers,
    });

  async function log(): Promise<AuditLogResponse> {
    return (
      await t.app.inject({
        method: 'GET',
        url: `/api/admin/stocktakes/${stocktakeId}/audit-log`,
      })
    ).json();
  }

  it('sets, changes and removes the serial number of a scanned line', async () => {
    const entry = await capture();
    t.takeEvents();

    const set = await setSerial(entry.id, '  SN-4711 ');
    expect(set.statusCode, set.body).toBe(200);
    expect(set.json<Entry>().serialNumber).toBe('SN-4711');
    expect(t.takeEvents()).toEqual([
      { type: 'entry.changed', action: 'updated', stocktakeId, workAreaId, entryId: entry.id },
    ]);

    expect((await setSerial(entry.id, 'SN-4712')).json<Entry>().serialNumber).toBe('SN-4712');
    expect((await setSerial(entry.id, '   ')).json<Entry>().serialNumber).toBeNull();
    expect((await setSerial(entry.id, 'SN-1')).json<Entry>().serialNumber).toBe('SN-1');
    expect((await setSerial(entry.id, null)).json<Entry>().serialNumber).toBeNull();

    const { entries } = await log();
    expect(entries.map((e) => [e.action, e.oldValue, e.newValue])).toEqual([
      ['serial_number_changed', 'SN-1', null],
      ['serial_number_changed', null, 'SN-1'],
      ['serial_number_changed', 'SN-4712', null],
      ['serial_number_changed', 'SN-4711', 'SN-4712'],
      ['serial_number_changed', null, 'SN-4711'],
    ]);
  });

  it('records nothing when the serial number stays the same', async () => {
    const entry = await capture();
    await setSerial(entry.id, 'SN-1');
    t.takeEvents();
    await setSerial(entry.id, ' SN-1 ');
    expect(t.takeEvents()).toEqual([]);
    expect((await log()).entries).toHaveLength(1);
  });

  it('rejects serial numbers longer than 100 characters', async () => {
    const entry = await capture();
    const response = await setSerial(entry.id, 'x'.repeat(101));
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('validation_failed');
  });

  it('rejects changes after the work area was closed', async () => {
    const entry = await capture();
    await post(`/api/station/work-areas/${workAreaId}/close`, {}, kasse);
    expect((await setSerial(entry.id, 'SN-1')).statusCode).toBe(409);
  });

  it('sets the serial number with a paired phone', async () => {
    const offer = (await post('/api/station/pairings', {}, kasse)).json();
    const device = {
      'x-device-token': (await post('/api/scan/pair', { code: offer.code })).json()
        .deviceToken as string,
    };
    const entry = await capture();
    const response = await setSerial(entry.id, 'SN-9', device, '/api/scan');
    expect(response.json<Entry>().serialNumber).toBe('SN-9');
    expect((await log()).entries[0]).toMatchObject({ source: 'phone', newValue: 'SN-9' });
  });

  it('shows the serial number in the export', async () => {
    const entry = await capture();
    await setSerial(entry.id, 'SN-4711');
    const csv = await t.app.inject({
      method: 'GET',
      url: `/api/admin/stocktakes/${stocktakeId}/export/entries?format=csv`,
    });
    expect(csv.body).toContain(';SN-4711;');
  });
});
