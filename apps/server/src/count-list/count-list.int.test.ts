import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../test/app.ts';

describe('count list', () => {
  let t: TestApp;
  let stocktakeId: number;
  let vitrine: number;

  function post(url: string, payload: object, token?: string) {
    return t.app.inject({
      method: 'POST',
      url,
      payload,
      headers: token ? { 'x-workstation-token': token } : {},
    });
  }

  const get = (query = '', id = stocktakeId) =>
    t.app.inject({ method: 'GET', url: `/api/admin/stocktakes/${id}/count-list${query}` });

  beforeAll(async () => {
    t = await createTestApp();
    await t.db
      .insertInto('master_data.article')
      .values({
        id: 1,
        description: 'Herrenring Gold',
        ean: '4000000000017',
        price_net: '100.00',
        price_gross: '119.00',
        category: 'Ringe',
      })
      .execute();
    stocktakeId = (await post('/api/admin/stocktakes', { name: 'Inventur 2026' })).json().id;
    vitrine = (
      await post(`/api/admin/stocktakes/${stocktakeId}/work-areas`, { name: 'Vitrine: 1' })
    ).json().id;
    await post(`/api/admin/stocktakes/${stocktakeId}/work-areas`, { name: 'Lager' });
    const anna = (
      await post(`/api/admin/stocktakes/${stocktakeId}/employees`, { name: 'Anna' })
    ).json().id;
    const { token } = (await post('/api/station/register', { name: 'Kasse' })).json();
    await post(`/api/station/employees/${anna}/login`, {}, token);
    await post(`/api/station/work-areas/${vitrine}/join`, {}, token);
    for (let i = 0; i < 3; i++) {
      await post('/api/station/entries', { input: '4000000000017' }, token);
    }
    expect((await post('/api/station/checkpoints', {}, token)).statusCode).toBe(201);
    await post('/api/station/entries', { input: '4000000000017' }, token);
  });
  afterAll(() => t.close());

  it('renders the count list of a work area as PDF', async () => {
    const response = await get(`?workAreaId=${vitrine}`);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers['content-type']).toBe('application/pdf');
    expect(response.headers['content-disposition']).toBe(
      `attachment; filename="Inventur 2026 - Zahlliste - Vitrine- 1.pdf"; ` +
        `filename*=UTF-8''Inventur%202026%20-%20Z%C3%A4hlliste%20-%20Vitrine-%201.pdf`,
    );
    expect(response.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('renders the count list of all work areas', async () => {
    const response = await get();
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-disposition']).toContain(
      'filename="Inventur 2026 - Zahlliste.pdf"',
    );
    // Summary page, then one page per work area.
    const pages = response.rawPayload.toString('latin1').match(/\/Type \/Page\b/g)?.length;
    expect(pages).toBe(3);
  });

  it('rejects unknown stocktakes and work areas', async () => {
    expect((await get('?workAreaId=999999')).statusCode).toBe(404);
    expect((await get('', 999999)).statusCode).toBe(404);
    expect((await get('?workAreaId=abc')).statusCode).toBe(400);
  });
});
