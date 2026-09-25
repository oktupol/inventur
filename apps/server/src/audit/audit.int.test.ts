import type { AuditLogResponse, CreateEntryResponse, Entry } from '@inventur/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../test/app.ts';

describe('audit log', () => {
  let t: TestApp;
  let stocktakeId: number;
  let workAreaId: number;
  let kasse: { token: string; id: number };
  let anna: number;

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
    const registered = (await post('/api/station/register', { name: 'Kasse' })).json();
    kasse = { token: registered.token, id: registered.workstation.id };
    anna = (await post(`/api/admin/stocktakes/${stocktakeId}/employees`, { name: 'Anna' })).json()
      .id;
    await post(`/api/station/employees/${anna}/login`, {}, station());
    await post(`/api/station/work-areas/${workAreaId}/join`, {}, station());
  });

  const station = () => ({ 'x-workstation-token': kasse.token });

  function post(url: string, payload: object, headers: Record<string, string> = {}) {
    return t.app.inject({ method: 'POST', url, payload, headers });
  }

  async function capture(input = '4000000000017'): Promise<Entry> {
    const response = await post('/api/station/entries', { input }, station());
    const body = response.json<CreateEntryResponse>();
    if (body.result !== 'unique') throw new Error(response.body);
    return body.entry;
  }

  function patch(entryId: number, payload: object, headers = station()) {
    return t.app.inject({
      method: 'PATCH',
      url: `/api/station/entries/${entryId}`,
      payload,
      headers,
    });
  }

  function remove(
    entryId: number,
    url = '/api/station/entries',
    headers: Record<string, string> = station(),
  ) {
    return t.app.inject({ method: 'DELETE', url: `${url}/${entryId}`, headers });
  }

  async function log(query = ''): Promise<AuditLogResponse> {
    const response = await t.app.inject({
      method: 'GET',
      url: `/api/admin/stocktakes/${stocktakeId}/audit-log${query}`,
    });
    expect(response.statusCode, response.body).toBe(200);
    return response.json();
  }

  it('records a quantity change with the old and new value', async () => {
    const entry = await capture();
    await patch(entry.id, { quantity: 5 });

    const { entries, hasMore } = await log();
    expect(hasMore).toBe(false);
    expect(entries).toEqual([
      {
        id: expect.any(Number),
        action: 'quantity_changed',
        entryId: entry.id,
        workArea: { id: workAreaId, name: 'Vitrine 1' },
        description: 'Herrenuhr',
        code: '4000000000017',
        oldValue: '1',
        newValue: '5',
        source: 'station',
        workstation: { id: kasse.id, name: 'Kasse' },
        employees: ['Anna'],
        createdAt: expect.any(String),
      },
    ]);
  });

  it('records one entry per change, including +/−', async () => {
    const entry = await capture();
    await patch(entry.id, { delta: 1 });
    await patch(entry.id, { delta: 1 });
    await patch(entry.id, { delta: -1 });

    const { entries } = await log();
    expect(entries.map((e) => [e.oldValue, e.newValue])).toEqual([
      ['3', '2'],
      ['2', '3'],
      ['1', '2'],
    ]);
  });

  it('records nothing when the quantity stays the same', async () => {
    const entry = await capture();
    await patch(entry.id, { delta: -1 });
    await patch(entry.id, { quantity: 1 });
    expect((await log()).entries).toEqual([]);
  });

  it('records a deletion with the complete line', async () => {
    const entry = await capture();
    await patch(entry.id, { quantity: 2 });
    expect((await remove(entry.id)).statusCode).toBe(200);

    const { entries } = await log();
    expect(entries[0]).toMatchObject({
      action: 'deleted',
      entryId: entry.id,
      oldValue: '2',
      newValue: null,
    });
    const row = await t.db
      .selectFrom('inventory.audit_log')
      .select('entry_snapshot')
      .where('action', '=', 'deleted')
      .executeTakeFirstOrThrow();
    expect(row.entry_snapshot).toMatchObject({
      entry: { id: entry.id, quantity: 2, description: 'Herrenuhr', work_area_id: workAreaId },
      employeeIds: [anna],
      checkpoints: [],
    });
  });

  it('keeps a checkpoint that is removed with the last line of its section', async () => {
    const entry = await capture();
    await post('/api/station/checkpoints', {}, station());
    await remove(entry.id);

    const row = await t.db
      .selectFrom('inventory.audit_log')
      .select('entry_snapshot')
      .executeTakeFirstOrThrow();
    const snapshot = row.entry_snapshot as { checkpoints: { work_area_id: number }[] };
    expect(snapshot.checkpoints).toHaveLength(1);
    expect(snapshot.checkpoints[0]).toMatchObject({ work_area_id: workAreaId });
  });

  it('records changes with a paired phone as such', async () => {
    const offer = (await post('/api/station/pairings', {}, station())).json();
    const device = (await post('/api/scan/pair', { code: offer.code })).json().deviceToken;
    const entry = await capture();
    await t.app.inject({
      method: 'PATCH',
      url: `/api/scan/entries/${entry.id}`,
      payload: { delta: 1 },
      headers: { 'x-device-token': device },
    });
    await remove(entry.id, '/api/scan/entries', { 'x-device-token': device });

    const { entries } = await log();
    expect(entries.map((e) => [e.action, e.source, e.workstation?.name])).toEqual([
      ['deleted', 'phone', 'Kasse'],
      ['quantity_changed', 'phone', 'Kasse'],
    ]);
  });

  it('records nothing when a change is rejected', async () => {
    const entry = await capture();
    await post(`/api/station/work-areas/${workAreaId}/close`, {}, station());
    expect((await patch(entry.id, { quantity: 3 })).statusCode).toBe(409);
    expect((await remove(entry.id)).statusCode).toBe(409);
    expect((await log()).entries).toEqual([]);
  });

  it('keeps the names at the time of the change', async () => {
    const entry = await capture();
    await patch(entry.id, { quantity: 2 });
    await t.app.inject({
      method: 'PATCH',
      url: `/api/admin/workstations/${kasse.id}`,
      payload: { name: 'Kasse neu' },
    });
    expect((await log()).entries[0]!.workstation).toEqual({ id: kasse.id, name: 'Kasse' });
  });

  it('filters by work area, workstation and action', async () => {
    const entry = await capture();
    await patch(entry.id, { quantity: 2 });
    await remove(entry.id);

    expect((await log('?action=deleted')).entries.map((e) => e.action)).toEqual(['deleted']);
    expect((await log(`?workAreaId=${workAreaId}`)).entries).toHaveLength(2);
    expect((await log(`?workAreaId=${workAreaId + 1000}`)).entries).toHaveLength(0);
    expect((await log(`?workstationId=${kasse.id}`)).entries).toHaveLength(2);
    expect((await log(`?workstationId=${kasse.id + 1000}`)).entries).toHaveLength(0);
  });

  it('pages from the newest entry backwards', async () => {
    const entry = await capture();
    for (let quantity = 2; quantity <= 202; quantity++) await patch(entry.id, { quantity });

    const first = await log();
    expect(first.entries).toHaveLength(200);
    expect(first.hasMore).toBe(true);
    expect(first.entries[0]!.newValue).toBe('202');
    const second = await log(`?before=${first.entries.at(-1)!.id}`);
    expect(second.entries.map((e) => e.newValue)).toEqual(['2']);
    expect(second.hasMore).toBe(false);
  });

  it('exports the filtered log as CSV and XLSX', async () => {
    const entry = await capture();
    await patch(entry.id, { quantity: 2 });
    await remove(entry.id);

    const csv = await t.app.inject({
      method: 'GET',
      url: `/api/admin/stocktakes/${stocktakeId}/audit-log/export?format=csv&action=deleted`,
    });
    expect(csv.statusCode, csv.body).toBe(200);
    expect(csv.headers['content-disposition']).toContain('.csv');
    const lines = csv.body.trim().split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain(
      ';Zeile gelöscht;Vitrine 1;Herrenuhr;="4000000000017";2;;Station;Kasse;Anna',
    );

    const xlsx = await t.app.inject({
      method: 'GET',
      url: `/api/admin/stocktakes/${stocktakeId}/audit-log/export?format=xlsx`,
    });
    expect(xlsx.statusCode).toBe(200);
    expect(xlsx.rawPayload.subarray(0, 2).toString()).toBe('PK');
  });

  it('rejects unknown stocktakes and filters', async () => {
    const unknown = await t.app.inject({
      method: 'GET',
      url: `/api/admin/stocktakes/${stocktakeId + 1000}/audit-log`,
    });
    expect(unknown.statusCode).toBe(404);
    const invalid = await t.app.inject({
      method: 'GET',
      url: `/api/admin/stocktakes/${stocktakeId}/audit-log?action=created`,
    });
    expect(invalid.statusCode).toBe(400);
  });
});
