import type { Employee, WorkArea, Workstation } from '@inventur/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../test/app.ts';

describe('managing employees, work areas and workstations', () => {
  let t: TestApp;
  let stocktakeId: number;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  beforeEach(async () => {
    await t.db.deleteFrom('inventory.entry').execute();
    await t.db.deleteFrom('inventory.workstation').execute();
    await t.db.deleteFrom('inventory.stocktake').execute();
    stocktakeId = await startStocktake('Inventur 2026');
    t.takeEvents();
  });

  async function startStocktake(name: string): Promise<number> {
    const response = await t.app.inject({
      method: 'POST',
      url: '/api/stocktakes',
      payload: { name },
    });
    return response.json().id;
  }

  const finish = (id = stocktakeId) =>
    t.app.inject({
      method: 'POST',
      url: `/api/stocktakes/${id}/finish`,
      payload: { confirm: true },
    });

  const request = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
    t.app.inject({ method, url, payload });

  async function createWorkstation(name: string, workAreaId: number | null = null) {
    return t.db
      .insertInto('inventory.workstation')
      .values({ name, token: `token-${name}`, work_area_id: workAreaId })
      .returning('id')
      .executeTakeFirstOrThrow();
  }

  async function createEntry(workAreaId: number, workstationId: number, employeeIds: number[]) {
    const { id } = await t.db
      .insertInto('inventory.entry')
      .values({
        stocktake_id: stocktakeId,
        work_area_id: workAreaId,
        article_id: null,
        is_manual: true,
        input: 'X',
        description: 'Ring',
        ean: null,
        category: null,
        price_net: null,
        price_gross: '10.00',
        serial_number: null,
        quantity: 2,
        workstation_id: workstationId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    if (employeeIds.length > 0) {
      await t.db
        .insertInto('inventory.entry_employee')
        .values(employeeIds.map((employee_id) => ({ entry_id: id, employee_id })))
        .execute();
    }
  }

  async function login(employeeId: number, workstationId: number) {
    await t.db
      .updateTable('inventory.employee')
      .set({ workstation_id: workstationId })
      .where('id', '=', employeeId)
      .execute();
  }

  describe('employees', () => {
    const url = () => `/api/stocktakes/${stocktakeId}/employees`;
    const add = async (name: string): Promise<Employee> =>
      (await request('POST', url(), { name })).json();

    it('are created and listed by name', async () => {
      const response = await request('POST', url(), { name: ' Ben ' });
      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({ name: 'Ben', workstation: null, entryCount: 0 });
      await add('Anna');
      const list: Employee[] = (await request('GET', url())).json();
      expect(list.map((e) => e.name)).toEqual(['Anna', 'Ben']);
      expect(t.takeEvents()).toHaveLength(2);
      expect(t.takeEvents()).toEqual([]);
    });

    it('have unique names within a stocktake, ignoring case', async () => {
      await add('Anna');
      const duplicate = await request('POST', url(), { name: 'ANNA' });
      expect(duplicate.statusCode).toBe(409);
      expect(duplicate.json()).toMatchObject({ code: 'name_taken' });
    });

    it('may have the same name in another stocktake', async () => {
      await add('Anna');
      await finish();
      stocktakeId = await startStocktake('Inventur 2027');
      expect((await request('POST', url(), { name: 'Anna' })).statusCode).toBe(201);
    });

    it('are removed without entries and logged out of their workstation', async () => {
      const anna = await add('Anna');
      const station = await createWorkstation('Kasse');
      await login(anna.id, station.id);
      t.takeEvents();

      const response = await request('DELETE', `${url()}/${anna.id}`);
      expect(response.statusCode).toBe(204);
      expect((await request('GET', url())).json()).toEqual([]);
      expect(t.takeEvents()).toEqual([
        { type: 'employee.changed', action: 'deleted', stocktakeId, employeeId: anna.id },
        { type: 'workstation.changed', action: 'updated', workstationId: station.id },
      ]);
    });

    it('cannot be removed with entries', async () => {
      const anna = await add('Anna');
      const area = (
        await request('POST', `/api/stocktakes/${stocktakeId}/work-areas`, { name: 'Vitrine' })
      ).json();
      const station = await createWorkstation('Kasse');
      await createEntry(area.id, station.id, [anna.id]);

      const response = await request('DELETE', `${url()}/${anna.id}`);
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ code: 'employee_has_entries' });
      const [listed] = (await request('GET', url())).json();
      expect(listed.entryCount).toBe(1);
    });

    it('can be logged out by force', async () => {
      const anna = await add('Anna');
      const station = await createWorkstation('Kasse');
      await login(anna.id, station.id);
      expect((await request('GET', url())).json()[0].workstation).toEqual({
        id: station.id,
        name: 'Kasse',
      });
      t.takeEvents();

      const response = await request('POST', `${url()}/${anna.id}/logout`);
      expect(response.statusCode).toBe(200);
      expect(response.json().workstation).toBeNull();
      expect(t.takeEvents()).toEqual([
        { type: 'employee.changed', action: 'updated', stocktakeId, employeeId: anna.id },
        { type: 'workstation.changed', action: 'updated', workstationId: station.id },
      ]);

      // Logging out again changes nothing and publishes nothing.
      expect((await request('POST', `${url()}/${anna.id}/logout`)).statusCode).toBe(200);
      expect(t.takeEvents()).toEqual([]);
    });

    it('are not found in another stocktake', async () => {
      const anna = await add('Anna');
      const other = await request(
        'DELETE',
        `/api/stocktakes/${stocktakeId + 1000}/employees/${anna.id}`,
      );
      expect(other.statusCode).toBe(404);
      expect((await request('DELETE', `${url()}/${anna.id + 1000}`)).statusCode).toBe(404);
      expect(
        (await request('GET', `/api/stocktakes/${stocktakeId + 1000}/employees`)).statusCode,
      ).toBe(404);
    });

    it('are imported from the previous stocktake, skipping existing names', async () => {
      await add('Anna');
      await add('Ben');
      const previousId = stocktakeId;
      await finish();
      stocktakeId = await startStocktake('Inventur 2027');
      await add('anna');
      t.takeEvents();

      const response = await request('POST', `${url()}/import`);
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.source).toEqual({ id: previousId, name: 'Inventur 2026' });
      expect(body.created.map((e: Employee) => e.name)).toEqual(['Ben']);
      expect(t.takeEvents()).toHaveLength(1);

      const again = await request('POST', `${url()}/import`);
      expect(again.json().created).toEqual([]);
    });

    it('cannot be imported without a previous stocktake', async () => {
      const response = await request('POST', `${url()}/import`);
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ code: 'no_previous_stocktake' });
    });
  });

  describe('work areas', () => {
    const url = () => `/api/stocktakes/${stocktakeId}/work-areas`;
    const add = async (name: string, description?: string): Promise<WorkArea> =>
      (await request('POST', url(), { name, description })).json();

    it('are created with an optional description and start open', async () => {
      const response = await request('POST', url(), { name: 'Vitrine 3', description: ' Links ' });
      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({
        name: 'Vitrine 3',
        description: 'Links',
        status: 'open',
        entryCount: 0,
        quantity: 0,
        workstations: [],
      });
      expect(t.takeEvents()).toEqual([
        {
          type: 'work_area.changed',
          action: 'created',
          stocktakeId,
          workAreaId: response.json().id,
        },
      ]);
    });

    it('have unique names within a stocktake', async () => {
      const area = await add('Lager');
      await add('Vitrine');
      expect((await request('POST', url(), { name: 'lager' })).json().code).toBe('name_taken');
      const rename = await request('PATCH', `${url()}/${area.id}`, { name: 'Vitrine' });
      expect(rename.statusCode).toBe(409);
      expect(rename.json().code).toBe('name_taken');
    });

    it('are renamed and change their description', async () => {
      const area = await add('Lager', 'Keller');
      t.takeEvents();
      const renamed = await request('PATCH', `${url()}/${area.id}`, { name: 'Lager Uhren' });
      expect(renamed.json()).toMatchObject({ name: 'Lager Uhren', description: 'Keller' });
      const cleared = await request('PATCH', `${url()}/${area.id}`, { description: '' });
      expect(cleared.json()).toMatchObject({ name: 'Lager Uhren', description: null });
      // Changing only the case of the own name is allowed.
      const recased = await request('PATCH', `${url()}/${area.id}`, { name: 'LAGER UHREN' });
      expect(recased.statusCode).toBe(200);
      expect(t.takeEvents()).toHaveLength(3);
    });

    it('list their entries and workstations', async () => {
      const area = await add('Vitrine');
      const station = await createWorkstation('Kasse', area.id);
      await createEntry(area.id, station.id, []);
      const [listed] = (await request('GET', url())).json();
      expect(listed).toMatchObject({
        entryCount: 1,
        quantity: 2,
        workstations: [{ id: station.id, name: 'Kasse' }],
      });
    });

    it('are deleted without entries; workstations leave them', async () => {
      const area = await add('Vitrine');
      const station = await createWorkstation('Kasse', area.id);
      t.takeEvents();
      expect((await request('DELETE', `${url()}/${area.id}`)).statusCode).toBe(204);
      expect((await request('GET', url())).json()).toEqual([]);
      const workstations: Workstation[] = (await request('GET', '/api/workstations')).json();
      expect(workstations[0]?.workArea).toBeNull();
      expect(t.takeEvents()).toEqual([
        { type: 'work_area.changed', action: 'deleted', stocktakeId, workAreaId: area.id },
        { type: 'workstation.changed', action: 'updated', workstationId: station.id },
      ]);
    });

    it('cannot be deleted with entries', async () => {
      const area = await add('Vitrine');
      const station = await createWorkstation('Kasse');
      await createEntry(area.id, station.id, []);
      const response = await request('DELETE', `${url()}/${area.id}`);
      expect(response.statusCode).toBe(409);
      expect(response.json().code).toBe('work_area_has_entries');
    });

    it('are imported from the previous stocktake with their descriptions', async () => {
      await add('Vitrine 1', 'Eingang');
      await add('Lager');
      await finish();
      stocktakeId = await startStocktake('Inventur 2027');
      await add('Lager');
      const response = await request('POST', `${url()}/import`);
      expect(response.json().created).toMatchObject([
        { name: 'Vitrine 1', description: 'Eingang', status: 'open' },
      ]);
    });
  });

  describe('workstations', () => {
    it('are listed with work area, employees and entries', async () => {
      const area = (
        await request('POST', `/api/stocktakes/${stocktakeId}/work-areas`, { name: 'Vitrine' })
      ).json();
      const anna = (
        await request('POST', `/api/stocktakes/${stocktakeId}/employees`, { name: 'Anna' })
      ).json();
      const station = await createWorkstation('Kasse', area.id);
      await createWorkstation('Büro');
      await login(anna.id, station.id);
      await createEntry(area.id, station.id, [anna.id]);

      const list: Workstation[] = (await request('GET', '/api/workstations')).json();
      expect(list).toEqual([
        {
          id: expect.any(Number),
          name: 'Büro',
          workArea: null,
          lastSeenAt: null,
          employees: [],
          entryCount: 0,
        },
        {
          id: station.id,
          name: 'Kasse',
          workArea: { id: area.id, name: 'Vitrine' },
          lastSeenAt: null,
          employees: [{ id: anna.id, name: 'Anna' }],
          entryCount: 1,
        },
      ]);
      expect(JSON.stringify(list)).not.toContain('token');
    });

    it('are renamed with unique names', async () => {
      const kasse = await createWorkstation('Kasse');
      await createWorkstation('Büro');
      const renamed = await request('PATCH', `/api/workstations/${kasse.id}`, { name: 'Kasse 1' });
      expect(renamed.statusCode).toBe(200);
      expect(renamed.json().name).toBe('Kasse 1');
      expect(t.takeEvents()).toEqual([
        { type: 'workstation.changed', action: 'updated', workstationId: kasse.id },
      ]);
      const duplicate = await request('PATCH', `/api/workstations/${kasse.id}`, { name: 'büro' });
      expect(duplicate.json().code).toBe('name_taken');
      expect((await request('PATCH', '/api/workstations/999999', { name: 'X' })).statusCode).toBe(
        404,
      );
    });

    it('are deleted without entries, logging out employees and leaving the work area', async () => {
      const area = (
        await request('POST', `/api/stocktakes/${stocktakeId}/work-areas`, { name: 'Vitrine' })
      ).json();
      await t.db.updateTable('inventory.work_area').set({ status: 'in_progress' }).execute();
      const anna = (
        await request('POST', `/api/stocktakes/${stocktakeId}/employees`, { name: 'Anna' })
      ).json();
      const station = await createWorkstation('Kasse', area.id);
      await login(anna.id, station.id);
      t.takeEvents();

      expect((await request('DELETE', `/api/workstations/${station.id}`)).statusCode).toBe(204);
      expect((await request('GET', '/api/workstations')).json()).toEqual([]);
      const [employee] = (await request('GET', `/api/stocktakes/${stocktakeId}/employees`)).json();
      expect(employee.workstation).toBeNull();
      // The last workstation left, so the area falls back to open.
      const [workArea] = (await request('GET', `/api/stocktakes/${stocktakeId}/work-areas`)).json();
      expect(workArea.status).toBe('open');
      expect(t.takeEvents()).toEqual([
        { type: 'workstation.changed', action: 'deleted', workstationId: station.id },
        { type: 'employee.changed', action: 'updated', stocktakeId, employeeId: anna.id },
        { type: 'work_area.changed', action: 'updated', stocktakeId, workAreaId: area.id },
      ]);
    });

    it('cannot be deleted with entries, even from a finished stocktake', async () => {
      const area = (
        await request('POST', `/api/stocktakes/${stocktakeId}/work-areas`, { name: 'Vitrine' })
      ).json();
      const station = await createWorkstation('Kasse');
      await createEntry(area.id, station.id, []);
      await finish();
      const response = await request('DELETE', `/api/workstations/${station.id}`);
      expect(response.statusCode).toBe(409);
      expect(response.json().code).toBe('workstation_has_entries');
    });

    it('can be renamed while no stocktake is active', async () => {
      const station = await createWorkstation('Kasse');
      await finish();
      expect(
        (await request('PATCH', `/api/workstations/${station.id}`, { name: 'K' })).statusCode,
      ).toBe(200);
    });
  });

  describe('in a finished stocktake', () => {
    it('reject every write', async () => {
      const anna = (
        await request('POST', `/api/stocktakes/${stocktakeId}/employees`, { name: 'Anna' })
      ).json();
      const area = (
        await request('POST', `/api/stocktakes/${stocktakeId}/work-areas`, { name: 'Vitrine' })
      ).json();
      await finish();
      stocktakeId = await startStocktake('Inventur 2027');
      const old = anna.stocktakeId;

      const writes = [
        request('POST', `/api/stocktakes/${old}/employees`, { name: 'Ben' }),
        request('POST', `/api/stocktakes/${old}/employees/import`),
        request('DELETE', `/api/stocktakes/${old}/employees/${anna.id}`),
        request('POST', `/api/stocktakes/${old}/employees/${anna.id}/logout`),
        request('POST', `/api/stocktakes/${old}/work-areas`, { name: 'Lager' }),
        request('POST', `/api/stocktakes/${old}/work-areas/import`),
        request('PATCH', `/api/stocktakes/${old}/work-areas/${area.id}`, { name: 'X' }),
        request('DELETE', `/api/stocktakes/${old}/work-areas/${area.id}`),
      ];
      for (const response of await Promise.all(writes)) {
        expect(response.statusCode).toBe(409);
        expect(response.json().code).toBe('stocktake_finished');
      }
      // Reading stays possible.
      expect((await request('GET', `/api/stocktakes/${old}/employees`)).json()).toHaveLength(1);
      expect((await request('GET', `/api/stocktakes/${old}/work-areas`)).json()).toHaveLength(1);
    });
  });
});
