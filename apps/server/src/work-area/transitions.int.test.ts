import type { StationState, WorkArea } from '@inventur/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../test/app.ts';

describe('work area transitions', () => {
  let t: TestApp;
  let stocktakeId: number;
  let vitrine: number;
  let lager: number;
  let kasse: string;
  let buero: string;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  beforeEach(async () => {
    await t.db.deleteFrom('inventory.workstation').execute();
    await t.db.deleteFrom('inventory.stocktake').execute();
    stocktakeId = (
      await t.app.inject({ method: 'POST', url: '/api/admin/stocktakes', payload: { name: 'I' } })
    ).json().id;
    vitrine = await createArea('Vitrine');
    lager = await createArea('Lager');
    kasse = await register('Kasse');
    buero = await register('Büro');
    t.takeEvents();
  });

  async function createArea(name: string): Promise<number> {
    const response = await t.app.inject({
      method: 'POST',
      url: `/api/admin/stocktakes/${stocktakeId}/work-areas`,
      payload: { name },
    });
    return response.json().id;
  }

  async function register(name: string): Promise<string> {
    const response = await t.app.inject({
      method: 'POST',
      url: '/api/station/register',
      payload: { name },
    });
    return response.json().token;
  }

  const station = (token: string, url: string) =>
    t.app.inject({
      method: url.startsWith('GET ') ? 'GET' : 'POST',
      url: url.replace(/^GET /, ''),
      headers: { 'x-workstation-token': token },
      payload: url.startsWith('GET ') ? undefined : {},
    });
  const admin = (url: string) =>
    t.app.inject({
      method: 'POST',
      url: `/api/admin/stocktakes/${stocktakeId}${url}`,
      payload: {},
    });

  const join = (token: string, id: number) => station(token, `/api/station/work-areas/${id}/join`);
  const leave = (token: string) => station(token, '/api/station/work-area/leave');

  async function areas(): Promise<Record<string, WorkArea>> {
    const list: WorkArea[] = (await station(kasse, 'GET /api/station/work-areas')).json();
    return Object.fromEntries(list.map((a) => [a.name, a]));
  }
  const statusOf = async (name: string) => (await areas())[name]!.status;

  it('lists the work areas of the active stocktake for workstations', async () => {
    expect(Object.keys(await areas())).toEqual(['Lager', 'Vitrine']);
  });

  it('becomes in progress when a workstation joins and open when the last one leaves', async () => {
    const joined = await join(kasse, vitrine);
    expect(joined.statusCode).toBe(200);
    expect((joined.json() as StationState).workArea).toEqual({
      id: vitrine,
      name: 'Vitrine',
      status: 'in_progress',
    });
    expect(await statusOf('Vitrine')).toBe('in_progress');

    await join(buero, vitrine);
    expect((await areas()).Vitrine!.workstations.map((w) => w.name)).toEqual(['Büro', 'Kasse']);

    await leave(kasse);
    expect(await statusOf('Vitrine')).toBe('in_progress');

    const left = await leave(buero);
    expect((left.json() as StationState).workArea).toBeNull();
    expect(await statusOf('Vitrine')).toBe('open');
  });

  it('publishes events for the work area and the workstation', async () => {
    await join(kasse, vitrine);
    const events = t.takeEvents();
    expect(events).toContainEqual({
      type: 'work_area.changed',
      action: 'updated',
      stocktakeId,
      workAreaId: vitrine,
    });
    expect(events).toContainEqual(expect.objectContaining({ type: 'workstation.changed' }));

    // Joining the same area again changes nothing.
    await join(kasse, vitrine);
    expect(t.takeEvents()).toEqual([]);
  });

  it('leaves the previous work area when joining another one', async () => {
    await join(kasse, vitrine);
    await join(kasse, lager);
    const all = await areas();
    expect(all.Vitrine!.status).toBe('open');
    expect(all.Lager!.status).toBe('in_progress');
    expect(all.Vitrine!.workstations).toEqual([]);
  });

  it('ignores leaving without a work area', async () => {
    expect((await leave(kasse)).statusCode).toBe(200);
    expect(t.takeEvents()).toEqual([]);
  });

  it('is closed by a workstation in it; all workstations leave', async () => {
    await join(kasse, vitrine);
    await join(buero, vitrine);
    t.takeEvents();
    const closed = await station(kasse, `/api/station/work-areas/${vitrine}/close`);
    expect(closed.statusCode).toBe(200);
    expect(closed.json().workArea).toBeNull();
    expect((await station(buero, 'GET /api/station/me')).json().workArea).toBeNull();

    const area = (await areas()).Vitrine!;
    expect(area.status).toBe('closed');
    expect(area.closedAt).not.toBeNull();
    expect(area.workstations).toEqual([]);
    const events = t.takeEvents();
    expect(events.filter((e) => e.type === 'workstation.changed')).toHaveLength(2);
  });

  it('cannot be closed by a workstation outside of it', async () => {
    await join(kasse, vitrine);
    const response = await station(buero, `/api/station/work-areas/${vitrine}/close`);
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('not_in_work_area');
    expect(await statusOf('Vitrine')).toBe('in_progress');
  });

  it('cannot be joined while closed, but after reopening', async () => {
    await admin(`/work-areas/${vitrine}/close`);
    const rejected = await join(kasse, vitrine);
    expect(rejected.statusCode).toBe(409);
    expect(rejected.json().code).toBe('work_area_closed');

    const reopened = await station(kasse, `/api/station/work-areas/${vitrine}/reopen`);
    expect(reopened.statusCode).toBe(200);
    const area = (await areas()).Vitrine!;
    expect(area.status).toBe('open');
    expect(area.closedAt).toBeNull();

    await join(kasse, vitrine);
    expect(await statusOf('Vitrine')).toBe('in_progress');
  });

  it('is closed and reopened by the administrator', async () => {
    await join(kasse, vitrine);
    expect((await admin(`/work-areas/${vitrine}/close`)).statusCode).toBe(204);
    expect(await statusOf('Vitrine')).toBe('closed');
    expect((await station(kasse, 'GET /api/station/me')).json().workArea).toBeNull();
    expect((await admin(`/work-areas/${vitrine}/reopen`)).statusCode).toBe(204);
    expect(await statusOf('Vitrine')).toBe('open');
    expect((await admin('/work-areas/999999/close')).statusCode).toBe(404);
  });

  it('keeps consistent statuses under concurrent joins and leaves', async () => {
    const tokens = [kasse, buero, await register('C'), await register('D')];
    await Promise.all(
      tokens.flatMap((token, i) => [
        join(token, i % 2 === 0 ? vitrine : lager).then(() => leave(token)),
        join(token, vitrine),
      ]),
    );
    for (const area of Object.values(await areas())) {
      expect(area.status).toBe(area.workstations.length > 0 ? 'in_progress' : 'open');
    }
  });

  it('rejects transitions without an active stocktake or in a finished one', async () => {
    await t.app.inject({
      method: 'POST',
      url: `/api/admin/stocktakes/${stocktakeId}/finish`,
      payload: { confirm: true },
    });
    expect((await join(kasse, vitrine)).json().code).toBe('no_active_stocktake');
    expect((await admin(`/work-areas/${vitrine}/close`)).json().code).toBe('stocktake_finished');
  });
});
