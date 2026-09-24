import { randomUUID } from 'node:crypto';
import type { CreateEntryResponse, EntryListResponse } from '@inventur/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../test/app.ts';

describe('capturing entries', () => {
  let t: TestApp;
  let stocktakeId: number;
  let workAreaId: number;
  let kasse: { token: string; id: number };
  let anna: number;

  beforeAll(async () => {
    t = await createTestApp();
    await t.db
      .insertInto('master_data.article')
      .values([
        {
          id: 1,
          description: 'Herrenring Gold',
          ean: '4000000000017',
          price_net: '100.00',
          price_gross: '119.00',
          category: 'Ringe',
        },
        {
          id: 2,
          description: 'Kette Silber',
          ean: '4000000000031',
          price_net: '10.00',
          price_gross: '11.90',
          category: 'Ketten',
        },
        {
          id: 3,
          description: 'Kette Silber lang',
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
    stocktakeId = (await post('/api/admin/stocktakes', { name: 'Inventur' })).json().id;
    workAreaId = (
      await post(`/api/admin/stocktakes/${stocktakeId}/work-areas`, { name: 'Vitrine' })
    ).json().id;
    kasse = await register('Kasse');
    anna = (await post(`/api/admin/stocktakes/${stocktakeId}/employees`, { name: 'Anna' })).json()
      .id;
    await post(`/api/station/employees/${anna}/login`, {}, kasse.token);
    await post(`/api/station/work-areas/${workAreaId}/join`, {}, kasse.token);
    t.takeEvents();
  });

  function post(url: string, payload: object, token?: string) {
    return t.app.inject({
      method: 'POST',
      url,
      payload,
      headers: token ? { 'x-workstation-token': token } : {},
    });
  }

  async function register(name: string) {
    const { token, workstation } = (await post('/api/station/register', { name })).json();
    return { token: token as string, id: workstation.id as number };
  }

  const capture = async (
    input: string,
    options: { articleId?: number; requestId?: string; token?: string } = {},
  ): Promise<CreateEntryResponse> => {
    const { token = kasse.token, ...rest } = options;
    const response = await post('/api/station/entries', { input, ...rest }, token);
    expect(response.statusCode, response.body).toBe(200);
    return response.json();
  };

  const list = async (token = kasse.token): Promise<EntryListResponse> =>
    (
      await t.app.inject({
        method: 'GET',
        url: '/api/station/entries',
        headers: { 'x-workstation-token': token },
      })
    ).json();

  it('creates a line with a snapshot of the master data and the employees', async () => {
    const response = await capture(' 4000000000017 ');
    expect(response).toMatchObject({
      result: 'unique',
      entry: {
        workAreaId,
        articleId: 1,
        isManual: false,
        input: '4000000000017',
        description: 'Herrenring Gold',
        ean: '4000000000017',
        category: 'Ringe',
        priceNet: '100.00',
        priceGross: '119.00',
        serialNumber: null,
        quantity: 1,
        workstation: { id: kasse.id, name: 'Kasse' },
        duplicateCount: 0,
      },
    });
    const entryId = (response as { entry: { id: number } }).entry.id;
    const employees = await t.db
      .selectFrom('inventory.entry_employee')
      .select('employee_id')
      .where('entry_id', '=', entryId)
      .execute();
    expect(employees).toEqual([{ employee_id: anna }]);
    expect(t.takeEvents()).toEqual([
      { type: 'entry.changed', action: 'created', stocktakeId, workAreaId, entryId },
    ]);
  });

  it('keeps the snapshot when the master data changes', async () => {
    await capture('4000000000017');
    await t.db
      .updateTable('master_data.article')
      .set({ description: 'Umbenannt', price_gross: '1.00' })
      .where('id', '=', 1)
      .execute();
    try {
      const [entry] = (await list()).entries;
      expect(entry).toMatchObject({ description: 'Herrenring Gold', priceGross: '119.00' });
    } finally {
      await t.db
        .updateTable('master_data.article')
        .set({ description: 'Herrenring Gold', price_gross: '119.00' })
        .where('id', '=', 1)
        .execute();
    }
  });

  it('returns the choices for an ambiguous input without creating a line', async () => {
    const response = await capture('4000000000031');
    expect(response.result).toBe('ambiguous');
    if (response.result !== 'ambiguous') return;
    expect(response.articles.map((a) => a.id)).toEqual([2, 3]);
    expect((await list()).entries).toEqual([]);

    const chosen = await capture('4000000000031', { articleId: 3 });
    expect(chosen).toMatchObject({
      result: 'unique',
      entry: { articleId: 3, input: '4000000000031' },
    });
  });

  it('reports unknown inputs without creating a line', async () => {
    expect(await capture('4099999999999')).toEqual({ result: 'not_found' });
    expect((await list()).entries).toEqual([]);
    expect(t.takeEvents()).toEqual([]);
  });

  it('rejects an unknown chosen article', async () => {
    const response = await post(
      '/api/station/entries',
      { input: 'x', articleId: 999 },
      kasse.token,
    );
    expect(response.statusCode).toBe(404);
  });

  it('lists the lines newest first with totals and marks repeated single items', async () => {
    await capture('4000000000017');
    await capture('4000000000031', { articleId: 2 });
    await capture('4000000000017');
    const { workArea, entries, totals } = await list();
    expect(workArea).toEqual({ id: workAreaId, name: 'Vitrine', status: 'in_progress' });
    expect(entries.map((e) => [e.articleId, e.duplicateCount])).toEqual([
      [1, 1],
      [2, 0],
      [1, 1],
    ]);
    expect(totals).toEqual({ quantity: 3, lines: 3, grossValue: '249.90' });
  });

  it('shows the lines to a second workstation in the same work area', async () => {
    const lager = await register('Lager');
    await post(`/api/station/work-areas/${workAreaId}/join`, {}, lager.token);
    await capture('4000000000017');
    const { entries } = await list(lager.token);
    expect(entries.map((e) => e.workstation.name)).toEqual(['Kasse']);
  });

  it('requires a work area and a logged-in employee', async () => {
    await post('/api/station/work-area/leave', {}, kasse.token);
    let response = await post('/api/station/entries', { input: '4000000000017' }, kasse.token);
    expect(response.json().code).toBe('no_work_area');
    expect(
      (
        await t.app.inject({
          method: 'GET',
          url: '/api/station/entries',
          headers: { 'x-workstation-token': kasse.token },
        })
      ).json().code,
    ).toBe('no_work_area');

    await post(`/api/station/work-areas/${workAreaId}/join`, {}, kasse.token);
    await post(`/api/station/employees/${anna}/logout`, {}, kasse.token);
    response = await post('/api/station/entries', { input: '4000000000017' }, kasse.token);
    expect(response.json().code).toBe('no_employee_logged_in');
  });

  it('rejects entries without an active stocktake', async () => {
    await post(`/api/admin/stocktakes/${stocktakeId}/finish`, { confirm: true });
    const response = await post('/api/station/entries', { input: '4000000000017' }, kasse.token);
    expect(response.json().code).toBe('no_active_stocktake');
  });

  it('creates a line only once per request id, also for concurrent retries', async () => {
    const requestId = randomUUID();
    const first = await capture('4000000000017', { requestId });
    const again = await capture('4000000000017', { requestId });
    expect(again).toEqual(first);

    const concurrentId = randomUUID();
    const responses = await Promise.all(
      Array.from({ length: 3 }, () => capture('4000000000017', { requestId: concurrentId })),
    );
    expect(new Set(responses.map((r) => (r as { entry: { id: number } }).entry.id)).size).toBe(1);
    expect((await list()).entries).toHaveLength(2);
  });

  it('keeps all of 20 quick scans', async () => {
    await Promise.all(
      Array.from({ length: 20 }, () => capture('4000000000017', { requestId: randomUUID() })),
    );
    const { totals } = await list();
    expect(totals.lines).toBe(20);
    expect(t.takeEvents().filter((e) => e.type === 'entry.changed')).toHaveLength(20);
  });

  it('validates the request', async () => {
    const empty = await post('/api/station/entries', { input: '  ' }, kasse.token);
    expect(empty.json().code).toBe('validation_failed');
    const badId = await post(
      '/api/station/entries',
      { input: 'x', requestId: 'not-a-uuid' },
      kasse.token,
    );
    expect(badId.statusCode).toBe(400);
  });

  describe('changing lines', () => {
    const patch = (id: number, payload: object, token = kasse.token) =>
      t.app.inject({
        method: 'PATCH',
        url: `/api/station/entries/${id}`,
        payload,
        headers: { 'x-workstation-token': token },
      });
    const remove = (id: number, token = kasse.token) =>
      t.app.inject({
        method: 'DELETE',
        url: `/api/station/entries/${id}`,
        headers: { 'x-workstation-token': token },
      });

    async function captured(): Promise<number> {
      const response = await capture('4000000000017');
      t.takeEvents();
      return (response as { entry: { id: number } }).entry.id;
    }

    it('increments, decrements (not below 1) and sets the quantity', async () => {
      const id = await captured();
      expect((await patch(id, { delta: 1 })).json().quantity).toBe(2);
      expect((await patch(id, { delta: -1 })).json().quantity).toBe(1);
      expect((await patch(id, { delta: -1 })).json().quantity).toBe(1);
      expect((await patch(id, { quantity: 20 })).json().quantity).toBe(20);
      expect((await list()).totals).toMatchObject({
        quantity: 20,
        lines: 1,
        grossValue: '2380.00',
      });
      // The decrement at 1 changed nothing and published nothing.
      expect(t.takeEvents()).toHaveLength(3);
      expect(t.takeEvents()).toEqual([]);
    });

    it('applies concurrent increments of two workstations', async () => {
      const id = await captured();
      const lager = await register('Lager');
      const ben = (
        await post(`/api/admin/stocktakes/${stocktakeId}/employees`, { name: 'Ben' })
      ).json().id;
      await post(`/api/station/employees/${ben}/login`, {}, lager.token);
      await post(`/api/station/work-areas/${workAreaId}/join`, {}, lager.token);
      await Promise.all([
        ...Array.from({ length: 5 }, () => patch(id, { delta: 1 })),
        ...Array.from({ length: 5 }, () => patch(id, { delta: 1 }, lager.token)),
      ]);
      expect((await list()).entries[0]!.quantity).toBe(11);
    });

    it('rejects invalid quantities', async () => {
      const id = await captured();
      for (const payload of [{ quantity: 0 }, { quantity: 1.5 }, { delta: 2 }, {}]) {
        expect((await patch(id, payload)).statusCode).toBe(400);
      }
    });

    it('deletes a line permanently', async () => {
      const id = await captured();
      const deleted = await remove(id);
      expect(deleted.statusCode).toBe(200);
      expect(deleted.json()).toEqual({ removedCheckpoints: [] });
      expect((await list()).entries).toEqual([]);
      expect(t.takeEvents()).toEqual([
        { type: 'entry.changed', action: 'deleted', stocktakeId, workAreaId, entryId: id },
      ]);
      expect((await remove(id)).statusCode).toBe(404);
    });

    it('only changes lines of the own work area', async () => {
      const id = await captured();
      const lagerArea = (
        await post(`/api/admin/stocktakes/${stocktakeId}/work-areas`, { name: 'Lager' })
      ).json().id;
      const lager = await register('Lager');
      const ben = (
        await post(`/api/admin/stocktakes/${stocktakeId}/employees`, { name: 'Ben' })
      ).json().id;
      await post(`/api/station/employees/${ben}/login`, {}, lager.token);
      await post(`/api/station/work-areas/${lagerArea}/join`, {}, lager.token);
      expect((await patch(id, { delta: 1 }, lager.token)).statusCode).toBe(404);
      expect((await remove(id, lager.token)).statusCode).toBe(404);
    });

    it('rejects changes in a closed work area', async () => {
      const id = await captured();
      await post(`/api/admin/stocktakes/${stocktakeId}/work-areas/${workAreaId}/close`, {});
      expect((await patch(id, { delta: 1 })).json().code).toBe('no_work_area');
    });
  });

  describe('manual entries', () => {
    const manual = (payload: object, token = kasse.token) =>
      post('/api/station/entries/manual', payload, token);

    it('stores the original input and marks the line as manual', async () => {
      const response = await manual({
        input: '4099999999994',
        description: 'Ring Silber',
        priceGross: '49,90',
        serialNumber: 'SN-7',
      });
      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({
        articleId: null,
        isManual: true,
        input: '4099999999994',
        description: 'Ring Silber',
        ean: null,
        category: null,
        priceNet: null,
        priceGross: '49.90',
        serialNumber: 'SN-7',
        quantity: 1,
        duplicateCount: 0,
      });
      const { entries, totals } = await list();
      expect(entries[0]!.isManual).toBe(true);
      expect(totals.grossValue).toBe('49.90');
      expect(t.takeEvents()).toEqual([
        expect.objectContaining({ type: 'entry.changed', action: 'created' }),
      ]);
    });

    it('works without a previous scan', async () => {
      const response = await manual({ input: '', description: 'Armband', priceGross: '20' });
      expect(response.json()).toMatchObject({ input: '', serialNumber: null });
    });

    it('validates description and price', async () => {
      expect((await manual({ input: '', description: ' ', priceGross: '1' })).json().code).toBe(
        'validation_failed',
      );
      expect((await manual({ input: '', description: 'Ring', priceGross: '0' })).json().code).toBe(
        'validation_failed',
      );
      expect((await manual({ input: '', description: 'Ring' })).statusCode).toBe(400);
    });

    it('requires a logged-in employee and is idempotent per request id', async () => {
      const requestId = randomUUID();
      const payload = { input: 'x', description: 'Ring', priceGross: '5', requestId };
      const [a, b] = await Promise.all([manual(payload), manual(payload)]);
      expect(a.json().id).toBe(b.json().id);
      expect((await list()).entries).toHaveLength(1);

      await post(`/api/station/employees/${anna}/logout`, {}, kasse.token);
      expect((await manual({ input: '', description: 'Ring', priceGross: '5' })).json().code).toBe(
        'no_employee_logged_in',
      );
    });
  });
});
