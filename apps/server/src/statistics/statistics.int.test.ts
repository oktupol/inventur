import type { Reconciliation, StocktakeStatistics } from '@inventur/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../test/app.ts';

describe('statistics and reconciliation', () => {
  let t: TestApp;
  let stocktakeId: number;
  let vitrine: number;
  let lager: number;
  let kasse: { token: string; id: number };
  let anna: number;
  let ben: number;

  function post(url: string, payload: object, token?: string) {
    return t.app.inject({
      method: 'POST',
      url,
      payload,
      headers: token ? { 'x-workstation-token': token } : {},
    });
  }

  async function get<T>(url: string): Promise<T> {
    const response = await t.app.inject({ method: 'GET', url });
    expect(response.statusCode, response.body).toBe(200);
    return response.json();
  }

  async function capture(input: string) {
    const response = await post('/api/station/entries', { input }, kasse.token);
    expect(response.json().result, response.body).toBe('unique');
    return response.json().entry.id as number;
  }

  beforeAll(async () => {
    t = await createTestApp();
    await t.db
      .insertInto('master_data.article')
      .values(
        [
          [1, 'Herrenring Gold', '4000000000017', '100.00', '119.00', 'Ringe'],
          [2, 'Kette Silber', '4000000000031', '10.00', '11.90', 'Ketten'],
          [3, 'Damenuhr', '4000000000048', '200.00', '238.00', 'Uhren'],
          [4, 'Etui', '4000000000055', '1.00', '1.19', null],
          [5, 'Alter Ring', '4000000000062', '50.00', '59.50', 'Ringe'],
        ].map(([id, description, ean, price_net, price_gross, category]) => ({
          id: id as number,
          description: description as string,
          ean: ean as string,
          price_net: price_net as string,
          price_gross: price_gross as string,
          category: category as string | null,
        })),
      )
      .execute();

    stocktakeId = (await post('/api/admin/stocktakes', { name: 'Inventur' })).json().id;
    const area = (name: string) =>
      post(`/api/admin/stocktakes/${stocktakeId}/work-areas`, { name });
    vitrine = (await area('Vitrine')).json().id;
    lager = (await area('Lager')).json().id;
    const buero = (await area('Büro')).json().id;
    await post(`/api/admin/stocktakes/${stocktakeId}/work-areas/${buero}/close`, {});
    const employee = (name: string) =>
      post(`/api/admin/stocktakes/${stocktakeId}/employees`, { name });
    anna = (await employee('Anna')).json().id;
    ben = (await employee('Ben')).json().id;
    await employee('Clara');
    const registered = (await post('/api/station/register', { name: 'Kasse' })).json();
    kasse = { token: registered.token, id: registered.workstation.id };

    await post(`/api/station/employees/${anna}/login`, {}, kasse.token);
    await post(`/api/station/work-areas/${vitrine}/join`, {}, kasse.token);
    await capture('4000000000017');
    await capture('4000000000031');
    await post(`/api/station/employees/${ben}/login`, {}, kasse.token);
    await capture('4000000000017');
    await capture('4000000000062');
    await post(`/api/station/work-areas/${lager}/join`, {}, kasse.token);
    const manual = await post(
      '/api/station/entries/manual',
      { input: '999', description: 'Brosche', priceGross: '30,00' },
      kasse.token,
    );
    expect(manual.statusCode, manual.body).toBe(201);
    await t.app.inject({
      method: 'PATCH',
      url: `/api/station/entries/${manual.json().id}`,
      payload: { quantity: 2 },
      headers: { 'x-workstation-token': kasse.token },
    });
    // The master data may change during the stocktake.
    await t.db.deleteFrom('master_data.article').where('id', '=', 5).execute();
  });
  afterAll(() => t.close());

  it('computes the key figures of a stocktake', async () => {
    const stats = await get<StocktakeStatistics>(`/api/admin/stocktakes/${stocktakeId}/statistics`);
    expect(stats.progress).toEqual({ open: 1, in_progress: 1, closed: 1, total: 3 });
    expect(stats.totals).toEqual({ lines: 5, quantity: 6, net: '260.00', gross: '369.40' });
    expect(stats.byWorkArea.map((a) => [a.name, a.lines, a.quantity, a.gross])).toEqual([
      ['Büro', 0, 0, '0.00'],
      ['Lager', 1, 2, '60.00'],
      ['Vitrine', 4, 4, '309.40'],
    ]);
    expect(stats.byCategory.map((c) => [c.category, c.manual, c.quantity, c.net])).toEqual([
      ['Ketten', false, 1, '10.00'],
      ['Ringe', false, 3, '250.00'],
      [null, true, 2, null],
    ]);
    expect(stats.byEmployee).toEqual([
      { id: anna, name: 'Anna', lines: 5, quantity: 6 },
      { id: ben, name: 'Ben', lines: 3, quantity: 4 },
      expect.objectContaining({ name: 'Clara', lines: 0 }),
    ]);
    expect(stats.byWorkstation).toEqual([{ id: kasse.id, name: 'Kasse', lines: 5, quantity: 6 }]);
    expect(stats.rate.buckets.reduce((sum, b) => sum + b.lines, 0)).toBe(5);
    expect(stats.manual).toMatchObject({ lines: 1, quantity: 2, gross: '60.00' });
    expect(stats.manual.entries[0]).toMatchObject({
      description: 'Brosche',
      input: '999',
      workArea: { id: lager, name: 'Lager' },
      workstation: { id: kasse.id, name: 'Kasse' },
    });
    expect(stats.duplicates).toEqual([
      {
        articleId: 1,
        description: 'Herrenring Gold',
        ean: '4000000000017',
        lines: 2,
        quantity: 2,
        workAreas: [{ id: vitrine, name: 'Vitrine' }],
      },
    ]);
  });

  it('compares the counted quantities with the current master data', async () => {
    const result = await get<Reconciliation>(`/api/admin/stocktakes/${stocktakeId}/reconciliation`);
    expect(result.articleCount).toBe(4);
    expect(result.shortage).toEqual({
      count: 2,
      net: '201.00',
      gross: '239.19',
      byCategory: [
        { category: 'Uhren', count: 1, net: '200.00', gross: '238.00' },
        { category: null, count: 1, net: '1.00', gross: '1.19' },
      ],
      articles: [
        expect.objectContaining({ articleId: 3, description: 'Damenuhr', priceGross: '238.00' }),
        expect.objectContaining({ articleId: 4, description: 'Etui', category: null }),
      ],
      truncated: false,
    });
    expect(result.surplus.items.map((i) => [i.kind, i.description, i.counted, i.surplus])).toEqual([
      ['unknown', 'Alter Ring', 1, 1],
      ['excess', 'Herrenring Gold', 2, 1],
      ['manual', 'Brosche', 2, 2],
    ]);
    expect(result.surplus).toMatchObject({ quantity: 4, net: '150.00', gross: '238.50' });
  });

  it('rejects unknown stocktakes', async () => {
    for (const path of ['statistics', 'reconciliation']) {
      const response = await t.app.inject({
        method: 'GET',
        url: `/api/admin/stocktakes/999999/${path}`,
      });
      expect(response.statusCode).toBe(404);
      expect(response.json().code).toBe('not_found');
    }
  });
});
