import type { AuditLogResponse, Stocktake, WorkArea } from '@inventur/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../test/app.ts';

describe('reopening a finished stocktake', () => {
  let t: TestApp;
  let kasse: Record<string, string>;

  beforeAll(async () => {
    t = await createTestApp();
    await t.db
      .insertInto('master_data.article')
      .values({
        id: 1,
        description: 'Herrenuhr',
        ean: '4006381333931',
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
    const { token } = (await post('/api/station/register', { name: 'Kasse' })).json();
    kasse = { 'x-workstation-token': token };
  });

  function post(url: string, payload: object = {}, headers: Record<string, string> = {}) {
    return t.app.inject({ method: 'POST', url, payload, headers });
  }

  const reopen = (id: number) => post(`/api/admin/stocktakes/${id}/reopen`);
  const finish = (id: number) => post(`/api/admin/stocktakes/${id}/finish`, { confirm: true });

  /** A stocktake with a closed work area and one in progress, captured and finished. */
  async function finishedStocktake(name = 'Inventur') {
    const id: number = (await post('/api/admin/stocktakes', { name })).json().id;
    const counting: number = (
      await post(`/api/admin/stocktakes/${id}/work-areas`, { name: 'Vitrine 1' })
    ).json().id;
    const closed: number = (
      await post(`/api/admin/stocktakes/${id}/work-areas`, { name: 'Vitrine 2' })
    ).json().id;
    const anna: number = (
      await post(`/api/admin/stocktakes/${id}/employees`, { name: 'Anna' })
    ).json().id;
    await post(`/api/admin/stocktakes/${id}/work-areas/${closed}/close`);
    await post(`/api/station/employees/${anna}/login`, {}, kasse);
    await post(`/api/station/work-areas/${counting}/join`, {}, kasse);
    await post('/api/station/entries', { input: '4006381333931' }, kasse);
    expect((await finish(id)).statusCode).toBe(200);
    t.takeEvents();
    return { id, counting, closed, anna };
  }

  async function workAreas(id: number): Promise<WorkArea[]> {
    return (
      await t.app.inject({ method: 'GET', url: `/api/admin/stocktakes/${id}/work-areas` })
    ).json();
  }

  it('makes the stocktake active and writable again', async () => {
    const { id, counting, closed, anna } = await finishedStocktake();
    const response = await reopen(id);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json<Stocktake>()).toMatchObject({ id, status: 'active', finishedAt: null });

    const active = (
      await t.app.inject({ method: 'GET', url: '/api/admin/stocktakes/active' })
    ).json().stocktake;
    expect(active.id).toBe(id);

    const areas = await workAreas(id);
    expect(areas.find((a) => a.id === counting)!.status).toBe('open');
    expect(areas.find((a) => a.id === closed)!.status).toBe('closed');

    // Employees log in again and capture as before.
    expect((await post(`/api/station/employees/${anna}/login`, {}, kasse)).statusCode).toBe(200);
    expect((await post(`/api/station/work-areas/${counting}/join`, {}, kasse)).statusCode).toBe(
      200,
    );
    const capture = await post('/api/station/entries', { input: '4006381333931' }, kasse);
    expect(capture.json().result).toBe('unique');
    expect((await finish(id)).statusCode).toBe(200);
  });

  it('publishes the change for dashboard and workstations', async () => {
    const { id, counting } = await finishedStocktake();
    await reopen(id);
    expect(t.takeEvents()).toEqual([
      { type: 'stocktake.changed', action: 'updated', stocktakeId: id },
      { type: 'work_area.changed', action: 'updated', stocktakeId: id, workAreaId: counting },
    ]);
  });

  it('records finishing and reopening in the audit log', async () => {
    const { id } = await finishedStocktake();
    await reopen(id);
    const log: AuditLogResponse = (
      await t.app.inject({ method: 'GET', url: `/api/admin/stocktakes/${id}/audit-log` })
    ).json();
    expect(log.entries.map((e) => [e.action, e.source, e.workstation])).toEqual([
      ['stocktake_reopened', 'admin', null],
      ['stocktake_finished', 'admin', null],
    ]);
  });

  it('reopens an older stocktake while no other one is active', async () => {
    const older = await finishedStocktake('Inventur 2025');
    await finishedStocktake('Inventur 2026');
    expect((await reopen(older.id)).statusCode).toBe(200);
  });

  it('is rejected while another stocktake is active', async () => {
    const { id } = await finishedStocktake();
    await post('/api/admin/stocktakes', { name: 'Neu' });
    const response = await reopen(id);
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('stocktake_already_active');
  });

  it('is rejected for an active or unknown stocktake', async () => {
    const id: number = (await post('/api/admin/stocktakes', { name: 'Aktiv' })).json().id;
    const active = await reopen(id);
    expect(active.statusCode).toBe(409);
    expect(active.json().code).toBe('stocktake_not_finished');
    expect((await reopen(id + 1000)).statusCode).toBe(404);
  });
});
