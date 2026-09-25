import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../test/app.ts';

describe('exports', () => {
  let t: TestApp;
  let stocktakeId: number;
  let vitrine: number;
  let lager: number;

  function post(url: string, payload: object, token?: string) {
    return t.app.inject({
      method: 'POST',
      url,
      payload,
      headers: token ? { 'x-workstation-token': token } : {},
    });
  }

  const download = (path: string) =>
    t.app.inject({ method: 'GET', url: `/api/admin/stocktakes/${stocktakeId}/export/${path}` });

  /** CSV lines without the byte order mark. */
  const csvLines = (body: string) => body.slice(1).trimEnd().split('\r\n');

  beforeAll(async () => {
    t = await createTestApp();
    await t.db
      .insertInto('master_data.article')
      .values([
        {
          id: 1,
          description: 'Herrenring Gold',
          ean: '4000000000017',
          price_net: '100.00',
          price_gross: '119.00',
          category: 'Ringe',
        },
        {
          id: 2,
          description: 'Kette Silber',
          ean: '4000000000031',
          price_net: '10.00',
          price_gross: '11.90',
          category: 'Ketten',
        },
        {
          id: 3,
          description: 'Damenuhr Größe S',
          ean: null,
          price_net: '200.00',
          price_gross: '238.00',
          category: 'Uhren',
        },
      ])
      .execute();
    await t.db
      .insertInto('master_data.article_number')
      .values([
        { article_id: 1, number: 'R-2' },
        { article_id: 1, number: 'R-1' },
        { article_id: 3, number: 'U-3' },
      ])
      .execute();

    stocktakeId = (await post('/api/admin/stocktakes', { name: 'Inventur 2026' })).json().id;
    const area = (name: string) =>
      post(`/api/admin/stocktakes/${stocktakeId}/work-areas`, { name });
    vitrine = (await area('Vitrine 1')).json().id;
    lager = (await area('Lager')).json().id;
    const anna = (
      await post(`/api/admin/stocktakes/${stocktakeId}/employees`, { name: 'Anna' })
    ).json().id;
    const { token } = (await post('/api/station/register', { name: 'Kasse' })).json();
    await post(`/api/station/employees/${anna}/login`, {}, token);

    await post(`/api/station/work-areas/${vitrine}/join`, {}, token);
    await post('/api/station/entries', { input: '4000000000017' }, token);
    await post('/api/station/entries', { input: '4000000000031' }, token);
    await post(`/api/station/work-areas/${lager}/join`, {}, token);
    await post('/api/station/entries', { input: '4000000000017' }, token);
    await post(
      '/api/station/entries/manual',
      { input: '999', description: 'Brosche; Unikat', priceGross: '30,00', serialNumber: 'SN-1' },
      token,
    );
  });
  afterAll(() => t.close());

  it('exports all lines as CSV for Excel', async () => {
    const response = await download('entries?format=csv');
    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(response.headers['content-disposition']).toBe(
      `attachment; filename="Inventur 2026 - Einzelzeilen.csv"; filename*=UTF-8''Inventur%202026%20-%20Einzelzeilen.csv`,
    );
    expect(response.body.startsWith('\uFEFF')).toBe(true);
    const lines = csvLines(response.body);
    expect(lines).toHaveLength(5);
    expect(lines[0]).toBe(
      'Arbeitsbereich;Bezeichnung;EAN;Artikelnummer(n);Kategorie;Seriennummer;Menge;Preis netto;Preis brutto;Summe netto;Summe brutto;manuell;Station;Mitarbeiter;Zeitpunkt',
    );
    expect(lines[1]).toMatch(
      /^Lager;Herrenring Gold;="4000000000017";R-1, R-2;Ringe;;1;100,00;119,00;100,00;119,00;nein;Kasse;Anna;\d\d\.\d\d\.\d{4} \d\d:\d\d:\d\d$/,
    );
    expect(lines[2]).toMatch(/^Lager;"Brosche; Unikat";;;;SN-1;1;;30,00;;30,00;ja;Kasse;Anna;/);
    expect(lines[3]).toMatch(/^Vitrine 1;Herrenring Gold;/);
    expect(lines[4]).toMatch(/^Vitrine 1;Kette Silber;="4000000000031";;Ketten;;1;10,00;11,90;/);
  });

  it('exports the lines of a work area', async () => {
    const response = await download(`entries?format=csv&workAreaId=${vitrine}`);
    expect(response.headers['content-disposition']).toContain(
      'filename="Inventur 2026 - Einzelzeilen - Vitrine 1.csv"',
    );
    const lines = csvLines(response.body);
    expect(lines.slice(1).every((line) => line.startsWith('Vitrine 1;'))).toBe(true);
    expect(lines).toHaveLength(3);
  });

  it('exports the lines aggregated per article', async () => {
    const lines = csvLines((await download('articles?format=csv')).body);
    expect(lines).toHaveLength(4);
    expect(lines[1]).toMatch(/^Lager;"Brosche; Unikat";;;;SN-1;1;1;;30,00;;30,00;ja;/);
    expect(lines[2]).toMatch(
      /^Lager, Vitrine 1;Herrenring Gold;="4000000000017";R-1, R-2;Ringe;;2;2;100,00;119,00;200,00;238,00;nein;Kasse;Anna;/,
    );
    expect(lines[3]).toMatch(/^Vitrine 1;Kette Silber;="4000000000031";;Ketten;;1;1;10,00;11,90;/);
  });

  it('exports the complete target/actual comparison', async () => {
    const lines = csvLines((await download('reconciliation?format=csv')).body);
    expect(lines).toEqual([
      'Ergebnis;Grund;Bezeichnung;EAN;Artikelnummer(n);Kategorie;Soll;Ist;Differenz;Preis netto;Preis brutto;Wert netto;Wert brutto',
      'Fehlbestand;nicht erfasst;Damenuhr Größe S;;U-3;Uhren;1;0;-1;200,00;238,00;-200,00;-238,00',
      'Mehrbestand;mehrfach gezählt;Herrenring Gold;="4000000000017";R-1, R-2;Ringe;1;2;1;100,00;119,00;100,00;119,00',
      'Mehrbestand;manuell erfasst;"Brosche; Unikat";;;;0;1;1;;30,00;;30,00',
    ]);
  });

  it('exports XLSX workbooks', async () => {
    const response = await download(`articles?format=xlsx&workAreaId=${lager}`);
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(response.headers['content-disposition']).toContain(
      'filename="Inventur 2026 - Artikel - Lager.xlsx"',
    );
    expect(response.rawPayload.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  });

  it('rejects invalid requests', async () => {
    expect((await download('entries')).statusCode).toBe(400);
    expect((await download('entries?format=pdf')).statusCode).toBe(400);
    expect((await download('other?format=csv')).statusCode).toBe(400);
    expect((await download(`reconciliation?format=csv&workAreaId=${lager}`)).statusCode).toBe(400);
    const unknownArea = await download('entries?format=csv&workAreaId=999999');
    expect(unknownArea.statusCode).toBe(404);
    const unknownStocktake = await t.app.inject({
      method: 'GET',
      url: '/api/admin/stocktakes/999999/export/entries?format=csv',
    });
    expect(unknownStocktake.statusCode).toBe(404);
  });
});
