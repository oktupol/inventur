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

  const del = (url: string) =>
    t.app.inject({ method: 'DELETE', url, headers: { 'x-workstation-token': token } });

  it('numbers checkpoints by position and counts pieces since the last one and the start', async () => {
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

  it('requires at least one line before a new checkpoint', async () => {
    let response = await post('/api/station/checkpoints', {}, token);
    expect(response.json().code).toBe('checkpoint_empty_section');
    await capture(1);
    await checkpoint();
    response = await post('/api/station/checkpoints', {}, token);
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('checkpoint_empty_section');
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

  it('inserts a checkpoint after any line and renumbers the later ones', async () => {
    const [a, b, c] = await capture(3);
    const end = await checkpoint();
    const inserted = await post('/api/station/checkpoints', { afterEntryId: a }, token);
    expect(inserted.statusCode).toBe(201);
    expect(inserted.json()).toMatchObject({ number: 1, sinceLast: 1, sinceStart: 1 });

    const { checkpoints, entries } = await list();
    expect(checkpoints.map((cp) => [cp.id, cp.number, cp.sinceLast, cp.sinceStart])).toEqual([
      [end.id, 2, 2, 3],
      [inserted.json().id, 1, 1, 1],
    ]);
    expect(entries.map((e) => [e.id, e.checkpointNumber])).toEqual([
      [c, 2],
      [b, 2],
      [a, 1],
    ]);
  });

  it('rejects inserting a checkpoint that would leave a section empty', async () => {
    const [a, b] = await capture(2);
    await post('/api/station/checkpoints', { afterEntryId: a }, token);
    // Directly after the existing checkpoint: the section before would be empty.
    let response = await post('/api/station/checkpoints', { afterEntryId: a }, token);
    expect(response.json().code).toBe('checkpoint_empty_section');
    // After line b the section after line a holds b, and the open section may be empty.
    response = await post('/api/station/checkpoints', { afterEntryId: b }, token);
    expect(response.statusCode).toBe(201);
    expect(
      (await post('/api/station/checkpoints', { afterEntryId: 999999 }, token)).statusCode,
    ).toBe(404);
  });

  it('deletes a checkpoint and merges its sections', async () => {
    await capture(1);
    const first = await checkpoint();
    await capture(2);
    await checkpoint();
    await capture(1);
    t.takeEvents();
    expect((await del(`/api/station/checkpoints/${first.id}`)).statusCode).toBe(204);
    expect(await counts()).toEqual({ checkpoints: [[1, 3, 3]], sinceLastCheckpoint: 1 });
    expect(t.takeEvents()).toEqual([
      {
        type: 'checkpoint.changed',
        action: 'deleted',
        stocktakeId,
        workAreaId,
        checkpointId: first.id,
      },
    ]);
    expect((await del(`/api/station/checkpoints/${first.id}`)).statusCode).toBe(404);
  });

  it('removes a checkpoint when the last line of its section is deleted', async () => {
    const [a] = await capture(1);
    await checkpoint();
    const [b, c] = await capture(2);
    const second = await checkpoint();
    await capture(1);
    t.takeEvents();

    // Deleting b keeps c in the section of checkpoint 2.
    let response = await del(`/api/station/entries/${b}`);
    expect(response.json()).toEqual({ removedCheckpoints: [] });

    // Deleting c empties the section, so checkpoint 2 is removed.
    response = await del(`/api/station/entries/${c}`);
    expect(response.json()).toEqual({ removedCheckpoints: [2] });
    expect(t.takeEvents()).toContainEqual({
      type: 'checkpoint.changed',
      action: 'deleted',
      stocktakeId,
      workAreaId,
      checkpointId: second.id,
    });
    expect(await counts()).toEqual({ checkpoints: [[1, 1, 1]], sinceLastCheckpoint: 1 });

    // Deleting a, the only line before checkpoint 1, removes that one too.
    response = await del(`/api/station/entries/${a}`);
    expect(response.json()).toEqual({ removedCheckpoints: [1] });
    expect(await counts()).toEqual({ checkpoints: [], sinceLastCheckpoint: 1 });
  });

  it('recounts when lines change later', async () => {
    const [a] = await capture(2);
    await checkpoint();
    await capture(1);
    await t.app.inject({
      method: 'PATCH',
      url: `/api/station/entries/${a}`,
      payload: { quantity: 10 },
      headers: { 'x-workstation-token': token },
    });
    expect(await counts()).toEqual({ checkpoints: [[1, 11, 11]], sinceLastCheckpoint: 1 });
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

  it('accepts only one of several concurrent checkpoints at the end', async () => {
    await capture(1);
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => post('/api/station/checkpoints', {}, token)),
    );
    expect(responses.map((r) => r.statusCode).sort()).toEqual([201, 409, 409, 409, 409]);
  });

  it('requires a logged-in employee and a work area', async () => {
    await capture(1);
    const cp = await checkpoint();
    await capture(1);
    await post(`/api/station/employees/${anna}/logout`, {}, token);
    expect((await post('/api/station/checkpoints', {}, token)).json().code).toBe(
      'no_employee_logged_in',
    );
    expect((await del(`/api/station/checkpoints/${cp.id}`)).json().code).toBe(
      'no_employee_logged_in',
    );
    await post('/api/station/work-area/leave', {}, token);
    expect((await post('/api/station/checkpoints', {}, token)).json().code).toBe('no_work_area');
  });

  it('counts everything since the start without checkpoints', async () => {
    await capture(3);
    expect(await counts()).toEqual({ checkpoints: [], sinceLastCheckpoint: 3 });
  });
});
