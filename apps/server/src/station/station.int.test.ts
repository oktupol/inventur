import type { StationEmployee, StationState, WorkstationRegistration } from '@inventur/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../test/app.ts';

describe('station API', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  beforeEach(async () => {
    await t.db.deleteFrom('inventory.workstation').execute();
    await t.db.deleteFrom('inventory.stocktake').execute();
    t.takeEvents();
  });

  const request = (
    method: 'GET' | 'POST',
    url: string,
    options: { token?: string; payload?: object } = {},
  ) =>
    t.app.inject({
      method,
      url,
      payload: options.payload,
      headers: options.token ? { 'x-workstation-token': options.token } : {},
    });

  async function register(name: string): Promise<WorkstationRegistration> {
    const response = await request('POST', '/api/station/register', { payload: { name } });
    expect(response.statusCode).toBe(201);
    return response.json();
  }

  async function startStocktake(employees: string[]): Promise<number[]> {
    const { id } = (
      await t.app.inject({
        method: 'POST',
        url: '/api/admin/stocktakes',
        payload: { name: 'Inventur' },
      })
    ).json();
    const ids: number[] = [];
    for (const name of employees) {
      const response = await t.app.inject({
        method: 'POST',
        url: `/api/admin/stocktakes/${id}/employees`,
        payload: { name },
      });
      ids.push(response.json().id);
    }
    t.takeEvents();
    return ids;
  }

  const me = async (token: string): Promise<StationState> =>
    (await request('GET', '/api/station/me', { token })).json();

  describe('registration', () => {
    it('creates a workstation with a secret token', async () => {
      const { token, workstation } = await register(' Kasse ');
      expect(workstation.name).toBe('Kasse');
      expect(token).toMatch(/^[\w-]{43}$/);
      expect(t.takeEvents()).toEqual([
        { type: 'workstation.changed', action: 'created', workstationId: workstation.id },
      ]);
      expect(await me(token)).toEqual({
        workstation,
        stocktake: null,
        employees: [],
        workArea: null,
      });
    });

    it('requires a unique name', async () => {
      await register('Kasse');
      const response = await request('POST', '/api/station/register', {
        payload: { name: 'kasse' },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json().code).toBe('name_taken');
    });

    it('rejects missing and unknown tokens', async () => {
      for (const token of [undefined, 'unknown']) {
        const response = await request('GET', '/api/station/me', { token });
        expect(response.statusCode).toBe(401);
        expect(response.json().code).toBe('workstation_unknown');
      }
    });

    it('records when the workstation was last seen', async () => {
      const { token, workstation } = await register('Kasse');
      await t.db
        .updateTable('inventory.workstation')
        .set({ last_seen_at: new Date('2020-01-01') })
        .execute();
      await me(token);
      const row = await t.db
        .selectFrom('inventory.workstation')
        .select('last_seen_at')
        .where('id', '=', workstation.id)
        .executeTakeFirstOrThrow();
      expect(Date.now() - row.last_seen_at!.getTime()).toBeLessThan(10_000);
    });

    it('lets another browser take over a workstation and invalidates the old token', async () => {
      const old = await register('Kasse');
      const list = (await request('GET', '/api/station/workstations')).json();
      expect(list).toEqual([old.workstation]);

      const response = await request('POST', '/api/station/take-over', {
        payload: { workstationId: old.workstation.id },
      });
      const taken: WorkstationRegistration = response.json();
      expect(taken.workstation).toEqual(old.workstation);
      expect(taken.token).not.toBe(old.token);
      expect((await me(taken.token)).workstation).toEqual(old.workstation);
      expect((await request('GET', '/api/station/me', { token: old.token })).statusCode).toBe(401);

      const missing = await request('POST', '/api/station/take-over', {
        payload: { workstationId: 999999 },
      });
      expect(missing.statusCode).toBe(404);
    });
  });

  describe('employees', () => {
    it('shows the active stocktake', async () => {
      const { token } = await register('Kasse');
      await startStocktake([]);
      expect((await me(token)).stocktake).toMatchObject({ name: 'Inventur' });
    });

    it('cannot be listed without an active stocktake', async () => {
      const { token } = await register('Kasse');
      const response = await request('GET', '/api/station/employees', { token });
      expect(response.json().code).toBe('no_active_stocktake');
    });

    it('can only log in to a second workstation after logging out at the first', async () => {
      const kasse = await register('Kasse');
      const lager = await register('Lager');
      const [anna, ben] = (await startStocktake(['Anna', 'Ben'])) as [number, number];

      const login = await request('POST', `/api/station/employees/${anna}/login`, {
        token: kasse.token,
      });
      expect(login.statusCode).toBe(200);
      expect(login.json().employees).toEqual([{ id: anna, name: 'Anna' }]);
      expect(t.takeEvents()).toEqual([
        {
          type: 'employee.changed',
          action: 'updated',
          stocktakeId: expect.any(Number),
          employeeId: anna,
        },
        { type: 'workstation.changed', action: 'updated', workstationId: kasse.workstation.id },
      ]);

      // The second workstation sees who is free.
      const employees: StationEmployee[] = (
        await request('GET', '/api/station/employees', { token: lager.token })
      ).json();
      expect(employees).toEqual([
        { id: anna, name: 'Anna', workstation: kasse.workstation },
        { id: ben, name: 'Ben', workstation: null },
      ]);

      const busy = await request('POST', `/api/station/employees/${anna}/login`, {
        token: lager.token,
      });
      expect(busy.statusCode).toBe(409);
      expect(busy.json().code).toBe('employee_busy');

      // Lager cannot log out an employee of Kasse.
      const foreign = await request('POST', `/api/station/employees/${anna}/logout`, {
        token: lager.token,
      });
      expect(foreign.json().code).toBe('employee_not_logged_in');

      const logout = await request('POST', `/api/station/employees/${anna}/logout`, {
        token: kasse.token,
      });
      expect(logout.json().employees).toEqual([]);

      const moved = await request('POST', `/api/station/employees/${anna}/login`, {
        token: lager.token,
      });
      expect(moved.statusCode).toBe(200);
      expect((await me(lager.token)).employees).toEqual([{ id: anna, name: 'Anna' }]);
    });

    it('allows several employees at one workstation and repeated logins', async () => {
      const kasse = await register('Kasse');
      const [anna, ben] = (await startStocktake(['Anna', 'Ben'])) as [number, number];
      await request('POST', `/api/station/employees/${anna}/login`, { token: kasse.token });
      await request('POST', `/api/station/employees/${ben}/login`, { token: kasse.token });
      t.takeEvents();
      const again = await request('POST', `/api/station/employees/${ben}/login`, {
        token: kasse.token,
      });
      expect(again.statusCode).toBe(200);
      expect(t.takeEvents()).toEqual([]);
      expect((await me(kasse.token)).employees.map((e) => e.name)).toEqual(['Anna', 'Ben']);
    });

    it('rejects concurrent logins of one employee at two workstations', async () => {
      const kasse = await register('Kasse');
      const lager = await register('Lager');
      const [anna] = (await startStocktake(['Anna'])) as [number];
      const responses = await Promise.all(
        [kasse, lager].map(({ token }) =>
          request('POST', `/api/station/employees/${anna}/login`, { token }),
        ),
      );
      expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    });

    it('cannot log in employees of a finished stocktake', async () => {
      const kasse = await register('Kasse');
      const [anna] = (await startStocktake(['Anna'])) as [number];
      const stocktake = (await me(kasse.token)).stocktake!;
      await t.app.inject({
        method: 'POST',
        url: `/api/admin/stocktakes/${stocktake.id}/finish`,
        payload: {},
      });
      const response = await request('POST', `/api/station/employees/${anna}/login`, {
        token: kasse.token,
      });
      expect(response.json().code).toBe('no_active_stocktake');
      expect((await me(kasse.token)).stocktake).toBeNull();
    });

    it('rejects unknown employees', async () => {
      const kasse = await register('Kasse');
      await startStocktake([]);
      const response = await request('POST', '/api/station/employees/999999/login', {
        token: kasse.token,
      });
      expect(response.statusCode).toBe(404);
    });
  });
});
