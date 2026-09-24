import type { Checkpoint, EntryListResponse } from '@inventur/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../test/app.ts';

describe('checkpoints', () => {
  let t: TestApp;
  let stocktakeId: number;
  let workAreaId: number;
  let token: string;
  let anna: number;

  beforeAll(async () => {
    t = await createTestApp();
    await t.db
      .insertInto('master_data.article')
      .values({
        id: 1,
        description: 'Batterie',
        ean: '4000000000017',
        price_net: '1.00',
        price_gross: '1.19',
        category: 'Zubehör',
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
      await post(`/api/admin/stocktakes/${stocktakeId}/work-areas`, { name: 'Lager' })
    ).json().id;
    token = (await post('/api/station/register', { name: 'Kasse' })).json().token;
    anna = (await post(`/api/admin/stocktakes/${stocktakeId}/employees`, { name: 'Anna' })).json()
      .id;
    await post(`/api/station/employees/${anna}/login`, {}, token);
    await post(`/api/station/work-areas/${workAreaId}/join`, {}, token);
    t.takeEvents();
  });

  function post(url: string, payload: object, auth?: string) {
    return t.app.inject({
      method: 'POST',
      url,
      payload,
      headers: auth ? { 'x-workstation-token': auth } : {},
    });
  }

  async function capture(times = 1): Promise<number[]> {
    const ids: number[] = [];
    for (let i = 0; i < times; i++) {
      const response = await post('/api/station/entries', { input: '4000000000017' }, token);
      ids.push(response.json().entry.id);
    }
    return ids;
  }

  async function checkpoint(): Promise<Checkpoint> {
    const response = await post('/api/station/checkpoints', {}, token);
    expect(response.statusCode, response.body).toBe(201);
    return response.json();
  }

  const list = async (): Promise<EntryListResponse> =>
    (
      await t.app.inject({
        method: 'GET',
        url: '/api/station/entries',
        headers: { 'x-workstation-token': token },
      })
    ).json();

  const counts = async () => {
    const { checkpoints, sinceLastCheckpoint } = await list();
    return {
      checkpoints: checkpoints.map((c) => [c.number, c.sinceLast, c.sinceStart]),
      sinceLastCheckpoint,
    };
  };

  it('numbers checkpoints per work area and counts pieces since the last one and the start', async () => {
    await capture(2);
    const first = await checkpoint();
    expect(first).toMatchObject({
      workAreaId,
      number: 1,
      workstation: { name: 'Kasse' },
      sinceLast: 2,
      sinceStart: 2,
    });
    expect(t.takeEvents()).toContainEqual({
      type: 'checkpoint.changed',
      action: 'created',
      stocktakeId,
      workAreaId,
      checkpointId: first.id,
    });

    await capture(3);
    expect((await checkpoint()).number).toBe(2);
    await capture(1);
    expect(await counts()).toEqual({
      checkpoints: [
        [2, 3, 5],
        [1, 2, 2],
      ],
      sinceLastCheckpoint: 1,
    });
  });

  it('assigns every line to its section', async () => {
    const [a] = await capture(1);
    await checkpoint();
    const [b] = await capture(1);
    const { entries } = await list();
    expect(entries.map((e) => [e.id, e.checkpointNumber])).toEqual([
      [b, null],
      [a, 1],
    ]);
  });

  it('recounts when lines change or are deleted later', async () => {
    const [a, b] = await capture(2);
    await checkpoint();
    await capture(1);
    const headers = { 'x-workstation-token': token };
    await t.app.inject({
      method: 'PATCH',
      url: `/api/station/entries/${a}`,
      payload: { quantity: 10 },
      headers,
    });
    expect(await counts()).toEqual({ checkpoints: [[1, 11, 11]], sinceLastCheckpoint: 1 });
    await t.app.inject({ method: 'DELETE', url: `/api/station/entries/${b}`, headers });
    expect(await counts()).toEqual({ checkpoints: [[1, 10, 10]], sinceLastCheckpoint: 1 });
  });

  it('keeps checkpoints when the area is closed and reopened', async () => {
    await capture(2);
    await checkpoint();
    await post(`/api/station/work-areas/${workAreaId}/close`, {}, token);
    await post(`/api/station/work-areas/${workAreaId}/reopen`, {}, token);
    await post(`/api/station/work-areas/${workAreaId}/join`, {}, token);
    await capture(1);
    expect((await checkpoint()).number).toBe(2);
    expect(await counts()).toEqual({
      checkpoints: [
        [2, 1, 3],
        [1, 2, 2],
      ],
      sinceLastCheckpoint: 0,
    });
  });

  it('gives concurrent checkpoints consecutive numbers', async () => {
    const created = await Promise.all(Array.from({ length: 5 }, () => checkpoint()));
    expect(created.map((c) => c.number).sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('can be set without a logged-in employee but not outside a work area', async () => {
    await post(`/api/station/employees/${anna}/logout`, {}, token);
    expect((await post('/api/station/checkpoints', {}, token)).statusCode).toBe(201);
    await post('/api/station/work-area/leave', {}, token);
    const response = await post('/api/station/checkpoints', {}, token);
    expect(response.json().code).toBe('no_work_area');
  });

  it('counts everything since the start without checkpoints', async () => {
    await capture(3);
    expect(await counts()).toEqual({ checkpoints: [], sinceLastCheckpoint: 3 });
  });
});
