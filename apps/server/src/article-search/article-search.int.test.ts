import type {
  CreateEntryResponse,
  Entry,
  StocktakeArticleDetail,
  StocktakeArticleSearchResponse,
} from '@inventur/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../test/app.ts';

describe('article search in a stocktake', () => {
  let t: TestApp;
  let stocktakeId: number;
  let workAreaId: number;
  let kasse: Record<string, string>;

  const watch = {
    id: 1,
    description: 'Herrenuhr Automatik Stahl',
    ean: '4000000000017',
    price_net: '1000.00',
    price_gross: '1190.00',
    category: 'Uhren',
    expected_quantity: 2,
  };
  const ring = {
    id: 2,
    description: 'Damenring Gold',
    ean: '4000000000031',
    price_net: '100.00',
    price_gross: '119.00',
    category: 'Ringe',
    expected_quantity: 1,
  };

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  beforeEach(async () => {
    await t.db.deleteFrom('inventory.entry').execute();
    await t.db.deleteFrom('inventory.workstation').execute();
    await t.db.deleteFrom('inventory.stocktake').execute();
    await t.db.deleteFrom('master_data.article').execute();
    await t.db.insertInto('master_data.article').values([watch, ring]).execute();
    await t.db
      .insertInto('master_data.article_number')
      .values({ article_id: 1, number: 'HU-100' })
      .execute();
    stocktakeId = (await post('/api/admin/stocktakes', { name: 'Inventur' })).json().id;
    workAreaId = (
      await post(`/api/admin/stocktakes/${stocktakeId}/work-areas`, { name: 'Vitrine 1' })
    ).json().id;
    const { token } = (await post('/api/station/register', { name: 'Kasse' })).json();
    kasse = { 'x-workstation-token': token };
    const anna = (
      await post(`/api/admin/stocktakes/${stocktakeId}/employees`, { name: 'Anna' })
    ).json().id;
    await post(`/api/station/employees/${anna}/login`, {}, kasse);
    await post(`/api/station/work-areas/${workAreaId}/join`, {}, kasse);
  });

  function post(url: string, payload: object, headers: Record<string, string> = {}) {
    return t.app.inject({ method: 'POST', url, payload, headers });
  }

  async function capture(input: string): Promise<Entry> {
    const body = (await post('/api/station/entries', { input }, kasse)).json<CreateEntryResponse>();
    if (body.result !== 'unique') throw new Error(`${input} not captured`);
    return body.entry;
  }

  const setSerial = (entryId: number, serialNumber: string) =>
    t.app.inject({
      method: 'PUT',
      url: `/api/station/entries/${entryId}/serial-number`,
      payload: { serialNumber },
      headers: kasse,
    });

  async function search(q: string): Promise<StocktakeArticleSearchResponse> {
    const response = await t.app.inject({
      method: 'GET',
      url: `/api/admin/stocktakes/${stocktakeId}/articles/search?q=${encodeURIComponent(q)}`,
    });
    expect(response.statusCode, response.body).toBe(200);
    return response.json();
  }

  async function detail(articleId: number): Promise<StocktakeArticleDetail> {
    const response = await t.app.inject({
      method: 'GET',
      url: `/api/admin/stocktakes/${stocktakeId}/articles/${articleId}`,
    });
    expect(response.statusCode, response.body).toBe(200);
    return response.json();
  }

  it('finds a master data article with its target and counted quantity', async () => {
    await capture('4000000000017');
    const second = await capture('4000000000017');
    await t.app.inject({
      method: 'PATCH',
      url: `/api/station/entries/${second.id}`,
      payload: { quantity: 3 },
      headers: kasse,
    });

    const { articles, manualEntries } = await search('HU-1');
    expect(manualEntries).toEqual([]);
    expect(articles).toEqual([
      {
        articleId: 1,
        description: 'Herrenuhr Automatik Stahl',
        ean: '4000000000017',
        articleNumbers: ['HU-100'],
        category: 'Uhren',
        priceGross: '1190.00',
        inMasterData: true,
        expectedQuantity: 2,
        countedQuantity: 4,
        lines: 2,
        matchedBy: 'article_number',
      },
    ]);
  });

  it('finds articles that were not captured', async () => {
    const { articles } = await search('damenring');
    expect(articles).toMatchObject([{ articleId: 2, countedQuantity: 0, lines: 0 }]);
  });

  it('finds an article by the serial number of a line', async () => {
    const entry = await capture('4000000000017');
    await setSerial(entry.id, 'SN-4711-A');
    const { articles } = await search('sn-47');
    expect(articles).toMatchObject([{ articleId: 1, matchedBy: 'serial_number' }]);
  });

  it('finds manual lines by description, input and serial number', async () => {
    await post(
      '/api/station/entries/manual',
      { input: '999123', description: 'Brosche Unikat', priceGross: '250', serialNumber: 'B-7' },
      kasse,
    );
    for (const [q, matchedBy] of [
      ['brosche', 'description'],
      ['9991', 'input'],
      ['b-7', 'serial_number'],
    ]) {
      const { manualEntries } = await search(q!);
      expect(manualEntries).toMatchObject([
        {
          description: 'Brosche Unikat',
          isManual: true,
          code: '999123',
          serialNumber: 'B-7',
          workArea: { id: workAreaId, name: 'Vitrine 1' },
          workstation: { name: 'Kasse' },
          employees: ['Anna'],
          matchedBy,
        },
      ]);
    }
  });

  it('finds captured articles that left the master data by their snapshot', async () => {
    await capture('4000000000031');
    await t.db.deleteFrom('master_data.article').where('id', '=', 2).execute();
    const { articles } = await search('damenring');
    expect(articles).toMatchObject([
      {
        articleId: 2,
        description: 'Damenring Gold',
        inMasterData: false,
        expectedQuantity: null,
        countedQuantity: 1,
      },
    ]);
  });

  it('ignores lines of other stocktakes and short queries', async () => {
    const entry = await capture('4000000000017');
    await setSerial(entry.id, 'SN-1');
    await post(`/api/admin/stocktakes/${stocktakeId}/finish`, { confirm: true });
    const other = (await post('/api/admin/stocktakes', { name: 'Zweite' })).json().id;
    const response = await t.app.inject({
      method: 'GET',
      url: `/api/admin/stocktakes/${other}/articles/search?q=SN-1`,
    });
    expect(response.json().articles).toEqual([]);
    expect(await search('S')).toEqual({ articles: [], manualEntries: [], hasMore: false });
  });

  it('shows all lines of an article with where, when and by whom', async () => {
    const first = await capture('4000000000017');
    await capture('4000000000031');
    const second = await capture('4000000000017');
    await setSerial(second.id, 'SN-2');

    const { article, entries } = await detail(1);
    expect(article).toMatchObject({ articleId: 1, countedQuantity: 2, lines: 2 });
    expect(entries.map((e) => e.id)).toEqual([first.id, second.id]);
    expect(entries[1]).toMatchObject({
      serialNumber: 'SN-2',
      quantity: 1,
      workArea: { id: workAreaId, name: 'Vitrine 1' },
      workstation: { name: 'Kasse' },
      employees: ['Anna'],
    });
  });

  it('finds a deleted line through the audit log', async () => {
    const kept = await capture('4000000000017');
    const deleted = await capture('4000000000017');
    await t.app.inject({
      method: 'PATCH',
      url: `/api/station/entries/${deleted.id}`,
      payload: { quantity: 2 },
      headers: kasse,
    });
    await t.app.inject({
      method: 'DELETE',
      url: `/api/station/entries/${deleted.id}`,
      headers: kasse,
    });
    await capture('4000000000031');

    const { entries, auditLog } = await detail(1);
    expect(entries.map((e) => e.id)).toEqual([kept.id]);
    expect(auditLog.map((e) => [e.action, e.entryId])).toEqual([
      ['deleted', deleted.id],
      ['quantity_changed', deleted.id],
    ]);
  });

  it('shows an article whose only line was deleted after it left the master data', async () => {
    const entry = await capture('4000000000031');
    await t.app.inject({
      method: 'DELETE',
      url: `/api/station/entries/${entry.id}`,
      headers: kasse,
    });
    await t.db.deleteFrom('master_data.article').where('id', '=', 2).execute();

    const { article, entries, auditLog } = await detail(2);
    expect(article).toMatchObject({ description: 'Damenring Gold', inMasterData: false, lines: 0 });
    expect(entries).toEqual([]);
    expect(auditLog).toHaveLength(1);
  });

  it('answers 404 for unknown articles', async () => {
    const response = await t.app.inject({
      method: 'GET',
      url: `/api/admin/stocktakes/${stocktakeId}/articles/999`,
    });
    expect(response.statusCode).toBe(404);
  });
});
