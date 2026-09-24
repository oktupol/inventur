import type { Stocktake, StocktakeSummary } from '@inventur/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../test/app.ts';
import { withWritableStocktake } from './service.ts';

describe('stocktake API', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  beforeEach(async () => {
    await t.db.deleteFrom('inventory.pairing').execute();
    await t.db.deleteFrom('inventory.workstation').execute();
    await t.db.deleteFrom('inventory.stocktake').execute();
    t.takeEvents();
  });

  const start = (name: string) =>
    t.app.inject({ method: 'POST', url: '/api/stocktakes', payload: { name } });
  const finish = (id: number, payload?: object) =>
    t.app.inject({ method: 'POST', url: `/api/stocktakes/${id}/finish`, payload });
  const active = async () =>
    (await t.app.inject({ method: 'GET', url: '/api/stocktakes/active' })).json().stocktake;

  async function addWorkArea(stocktakeId: number, name: string, status = 'open') {
    return t.db
      .insertInto('inventory.work_area')
      .values({ stocktake_id: stocktakeId, name, status: status as 'open' })
      .returning('id')
      .executeTakeFirstOrThrow();
  }

  it('reports no active stocktake initially', async () => {
    expect(await active()).toBeNull();
  });

  it('starts a stocktake with a normalized name', async () => {
    const response = await start('  Inventur  2026 ');
    expect(response.statusCode).toBe(201);
    const stocktake: Stocktake = response.json();
    expect(stocktake).toMatchObject({ name: 'Inventur 2026', status: 'active', finishedAt: null });
    expect(await active()).toEqual(stocktake);
    expect(t.takeEvents()).toEqual([
      { type: 'stocktake.changed', action: 'created', stocktakeId: stocktake.id },
    ]);
  });

  it('rejects an empty or missing name', async () => {
    expect((await start('  ')).json()).toMatchObject({ code: 'validation_failed' });
    const missing = await t.app.inject({ method: 'POST', url: '/api/stocktakes', payload: {} });
    expect(missing.statusCode).toBe(400);
    expect(missing.json()).toMatchObject({ code: 'validation_failed' });
  });

  it('rejects a second active stocktake', async () => {
    await start('Inventur 2026');
    const response = await start('Inventur 2027');
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'stocktake_already_active' });
  });

  it('allows only one of two concurrent starts', async () => {
    const responses = await Promise.all([start('A'), start('B')]);
    expect(responses.map((r) => r.statusCode).sort()).toEqual([201, 409]);
  });

  it('finishes a stocktake without work areas right away', async () => {
    const { id } = (await start('Inventur')).json();
    t.takeEvents();
    const response = await finish(id);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id, status: 'finished' });
    expect(response.json().finishedAt).not.toBeNull();
    expect(await active()).toBeNull();
    expect(t.takeEvents()).toEqual([
      { type: 'stocktake.changed', action: 'updated', stocktakeId: id },
    ]);
  });

  it('asks for confirmation while work areas are not closed', async () => {
    const { id } = (await start('Inventur')).json();
    await addWorkArea(id, 'Vitrine 1', 'closed');
    const open = await addWorkArea(id, 'Lager', 'open');
    const response = await finish(id);
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      code: 'unclosed_work_areas',
      details: { workAreas: [{ id: open.id, name: 'Lager', status: 'open' }] },
    });
    expect((await active()).id).toBe(id);

    const confirmed = await finish(id, { confirm: true });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json().status).toBe('finished');
  });

  it('logs out employees, detaches workstations and disconnects pairings', async () => {
    const { id } = (await start('Inventur')).json();
    const area = await addWorkArea(id, 'Vitrine', 'in_progress');
    const workstation = await t.db
      .insertInto('inventory.workstation')
      .values({ name: 'Kasse', token: 'secret', work_area_id: area.id })
      .returning('id')
      .executeTakeFirstOrThrow();
    const employee = await t.db
      .insertInto('inventory.employee')
      .values({ stocktake_id: id, name: 'Anna', workstation_id: workstation.id })
      .returning('id')
      .executeTakeFirstOrThrow();
    await t.db
      .insertInto('inventory.pairing')
      .values({
        workstation_id: workstation.id,
        one_time_code: '123456',
        qr_token: 'qr',
        valid_until: new Date(),
        device_token: 'device',
        paired_at: new Date(),
      })
      .execute();
    t.takeEvents();

    expect((await finish(id, { confirm: true })).statusCode).toBe(200);

    const station = await t.db
      .selectFrom('inventory.workstation')
      .select('work_area_id')
      .executeTakeFirstOrThrow();
    expect(station.work_area_id).toBeNull();
    const person = await t.db
      .selectFrom('inventory.employee')
      .select('workstation_id')
      .executeTakeFirstOrThrow();
    expect(person.workstation_id).toBeNull();
    expect(await t.db.selectFrom('inventory.pairing').selectAll().execute()).toEqual([]);
    expect(t.takeEvents()).toEqual([
      { type: 'stocktake.changed', action: 'updated', stocktakeId: id },
      { type: 'employee.changed', action: 'updated', stocktakeId: id, employeeId: employee.id },
      { type: 'workstation.changed', action: 'updated', workstationId: workstation.id },
    ]);
  });

  describe('a finished stocktake', () => {
    let id: number;

    beforeEach(async () => {
      ({ id } = (await start('Inventur')).json());
      await finish(id);
      t.takeEvents();
    });

    it('cannot be finished again', async () => {
      const response = await finish(id, { confirm: true });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ code: 'stocktake_finished' });
      expect(t.takeEvents()).toEqual([]);
    });

    it('rejects writes', async () => {
      let written = false;
      await expect(
        withWritableStocktake(t.db, id, async () => {
          written = true;
        }),
      ).rejects.toMatchObject({ code: 'stocktake_finished' });
      expect(written).toBe(false);
    });

    it('allows starting a new stocktake', async () => {
      expect((await start('Nachinventur')).statusCode).toBe(201);
    });
  });

  it('allows writes to the active stocktake', async () => {
    const { id } = (await start('Inventur')).json();
    const result = await withWritableStocktake(t.db, id, async (trx) =>
      trx
        .insertInto('inventory.work_area')
        .values({ stocktake_id: id, name: 'Vitrine' })
        .returning('name')
        .executeTakeFirstOrThrow(),
    );
    expect(result.name).toBe('Vitrine');
  });

  it('responds with 404 for unknown stocktakes', async () => {
    const get = await t.app.inject({ method: 'GET', url: '/api/stocktakes/999999' });
    expect(get.statusCode).toBe(404);
    expect(get.json()).toMatchObject({ code: 'not_found' });
    expect((await finish(999999)).json()).toMatchObject({ code: 'not_found' });
    const invalid = await t.app.inject({ method: 'GET', url: '/api/stocktakes/abc' });
    expect(invalid.statusCode).toBe(400);
  });

  it('lists all stocktakes newest first with key figures', async () => {
    const first = (await start('Inventur 2025')).json();
    await addWorkArea(first.id, 'Vitrine 1', 'closed');
    await addWorkArea(first.id, 'Vitrine 2', 'open');
    await finish(first.id, { confirm: true });
    const second = (await start('Inventur 2026')).json();

    const response = await t.app.inject({ method: 'GET', url: '/api/stocktakes' });
    const list: StocktakeSummary[] = response.json();
    expect(list.map((s) => s.id)).toEqual([second.id, first.id]);
    expect(list[1]).toMatchObject({
      name: 'Inventur 2025',
      status: 'finished',
      workAreaCount: 2,
      closedWorkAreaCount: 1,
      employeeCount: 0,
      entryCount: 0,
      quantity: 0,
    });
  });
});
