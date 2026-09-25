import type {
  CreateEntryResponse,
  DeleteEntryResponse,
  Entry,
  EntryListResponse,
  RestoreEntryResponse,
} from '@inventur/shared';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../test/app.ts';

describe('restoring a deleted line', () => {
  let t: TestApp;
  let stocktakeId: number;
  let workAreaId: number;
  let kasse: Record<string, string>;
  let kasseId: number;
  let anna: number;

  beforeAll(async () => {
    t = await createTestApp({ publicHost: '192.168.1.10' });
    await t.db
      .insertInto('master_data.article')
      .values([
        {
          id: 1,
          description: 'Herrenuhr',
          ean: '4000000000017',
          price_net: '100.00',
          price_gross: '119.00',
          category: 'Uhren',
        },
        {
          id: 2,
          description: 'Kette',
          ean: '4000000000031',
          price_net: '10.00',
          price_gross: '11.90',
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
    stocktakeId = (await post('/api/admin/stocktakes', { name: 'Inventur' })).json().id;
    workAreaId = (
      await post(`/api/admin/stocktakes/${stocktakeId}/work-areas`, { name: 'Vitrine 1' })
    ).json().id;
    const station = await register('Kasse');
    kasse = station.headers;
    kasseId = station.id;
    anna = (await post(`/api/admin/stocktakes/${stocktakeId}/employees`, { name: 'Anna' })).json()
      .id;
    await post(`/api/station/employees/${anna}/login`, {}, kasse);
    await post(`/api/station/work-areas/${workAreaId}/join`, {}, kasse);
    t.takeEvents();
  });

  function post(url: string, payload: object, headers: Record<string, string> = {}) {
    return t.app.inject({ method: 'POST', url, payload, headers });
  }

  async function register(name: string) {
    const { token, workstation } = (await post('/api/station/register', { name })).json();
    return { headers: { 'x-workstation-token': token as string }, id: workstation.id as number };
  }

  async function capture(input = '4000000000017', headers = kasse): Promise<Entry> {
    const response = await post('/api/station/entries', { input }, headers);
    const body = response.json<CreateEntryResponse>();
    if (body.result !== 'unique') throw new Error(response.body);
    return body.entry;
  }

  async function remove(
    entryId: number,
    headers = kasse,
    base = '/api/station',
  ): Promise<DeleteEntryResponse> {
    const response = await t.app.inject({
      method: 'DELETE',
      url: `${base}/entries/${entryId}`,
      headers,
    });
    expect(response.statusCode, response.body).toBe(200);
    return response.json();
  }

  const restore = (entryId: number, headers = kasse, base = '/api/station') =>
    post(`${base}/entries/restore`, { entryId }, headers);

  async function list(headers = kasse): Promise<EntryListResponse> {
    return (await t.app.inject({ method: 'GET', url: '/api/station/entries', headers })).json();
  }

  it('brings the line back with the same data and place', async () => {
    const first = await capture();
    const second = await capture('4000000000031');
    await t.app.inject({
      method: 'PATCH',
      url: `/api/station/entries/${first.id}`,
      payload: { quantity: 3 },
      headers: kasse,
    });
    const before = (await list()).entries.find((e) => e.id === first.id)!;
    await remove(first.id);
    t.takeEvents();

    const response = await restore(first.id);
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json<RestoreEntryResponse>();
    expect(body.restoredCheckpoints).toEqual([]);
    expect(body.entry).toEqual({ ...before, checkpointNumber: null });

    const { entries } = await list();
    expect(entries.map((e) => e.id)).toEqual([second.id, first.id]);
    const employees = await t.db
      .selectFrom('inventory.entry_employee')
      .select('employee_id')
      .where('entry_id', '=', first.id)
      .execute();
    expect(employees).toEqual([{ employee_id: anna }]);
    expect(t.takeEvents()).toContainEqual({
      type: 'entry.changed',
      action: 'created',
      stocktakeId,
      workAreaId,
      entryId: first.id,
    });
  });

  it('keeps the capture time to the microsecond', async () => {
    const entry = await capture();
    const time = () =>
      sql<{ t: string }>`SELECT created_at::text AS t FROM inventory.entry WHERE id = ${entry.id}`
        .execute(t.db)
        .then((r) => r.rows[0]?.t);
    const original = await time();
    await remove(entry.id);
    await restore(entry.id);
    expect(await time()).toBe(original);
  });

  it('restores a checkpoint removed with the line, in its old place', async () => {
    const first = await capture();
    await post('/api/station/checkpoints', {}, kasse);
    const second = await capture('4000000000031');
    await post('/api/station/checkpoints', {}, kasse);
    const removed = await remove(second.id);
    expect(removed.removedCheckpoints).toEqual([2]);

    const body = (await restore(second.id)).json<RestoreEntryResponse>();
    expect(body.restoredCheckpoints).toEqual([2]);
    const { entries, checkpoints } = await list();
    expect(checkpoints.map((c) => c.number)).toEqual([2, 1]);
    expect(entries.find((e) => e.id === second.id)!.checkpointNumber).toBe(2);
    expect(entries.find((e) => e.id === first.id)!.checkpointNumber).toBe(1);
  });

  it('records the restoration in the audit log', async () => {
    const entry = await capture();
    await remove(entry.id);
    await restore(entry.id);
    const log = (
      await t.app.inject({ method: 'GET', url: `/api/admin/stocktakes/${stocktakeId}/audit-log` })
    ).json();
    expect(log.entries[0]).toMatchObject({
      action: 'restored',
      entryId: entry.id,
      newValue: '1',
      source: 'station',
      workstation: { id: kasseId, name: 'Kasse' },
    });
  });

  it('answers a repeated request without restoring twice', async () => {
    const entry = await capture();
    await remove(entry.id);
    await restore(entry.id);
    const again = await restore(entry.id);
    expect(again.statusCode).toBe(200);
    expect(again.json<RestoreEntryResponse>().entry.id).toBe(entry.id);
    const restored = await t.db
      .selectFrom('inventory.audit_log')
      .select('id')
      .where('action', '=', 'restored')
      .execute();
    expect(restored).toHaveLength(1);
  });

  it('restores only the line deleted last', async () => {
    const first = await capture();
    const second = await capture('4000000000031');
    await remove(first.id);
    await remove(second.id);
    const response = await restore(first.id);
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('restore_unavailable');
    expect((await restore(second.id)).statusCode).toBe(200);
  });

  it('lets only the deleting workstation restore', async () => {
    const other = await register('Lager');
    const bert = (
      await post(`/api/admin/stocktakes/${stocktakeId}/employees`, { name: 'Bert' })
    ).json().id;
    await post(`/api/station/employees/${bert}/login`, {}, other.headers);
    await post(`/api/station/work-areas/${workAreaId}/join`, {}, other.headers);
    const entry = await capture();
    await remove(entry.id);

    const response = await restore(entry.id, other.headers);
    expect(response.json().code).toBe('restore_unavailable');
  });

  it('rejects late requests', async () => {
    const entry = await capture();
    await remove(entry.id);
    await t.db
      .updateTable('inventory.audit_log')
      .set({ created_at: sql`now() - interval '2 minutes'` })
      .execute();
    expect((await restore(entry.id)).json().code).toBe('restore_unavailable');
  });

  it('rejects restoring after the work area was closed', async () => {
    const entry = await capture();
    await remove(entry.id);
    await post(`/api/station/work-areas/${workAreaId}/close`, {}, kasse);
    const response = await restore(entry.id);
    expect(response.statusCode).toBe(409);
    expect(await t.db.selectFrom('inventory.entry').select('id').execute()).toEqual([]);
  });

  it('rejects restoring after the stocktake was finished', async () => {
    const entry = await capture();
    await remove(entry.id);
    await post(`/api/admin/stocktakes/${stocktakeId}/finish`, { confirm: true });
    expect((await restore(entry.id)).statusCode).toBe(409);
  });

  it('restores a line deleted with a paired phone from the phone', async () => {
    const offer = (await post('/api/station/pairings', {}, kasse)).json();
    const device = {
      'x-device-token': (await post('/api/scan/pair', { code: offer.code })).json()
        .deviceToken as string,
    };
    const entry = await capture();
    await remove(entry.id, device, '/api/scan');

    const response = await restore(entry.id, device, '/api/scan');
    expect(response.statusCode, response.body).toBe(200);
    const row = await t.db
      .selectFrom('inventory.audit_log')
      .select('source')
      .where('action', '=', 'restored')
      .executeTakeFirstOrThrow();
    expect(row.source).toBe('phone');
  });
});
