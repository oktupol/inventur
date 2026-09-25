import type { MasterDataArticlePage, MasterDataOverview } from '@inventur/shared';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../test/app.ts';
import { seedMasterData } from './seed.ts';

async function get<T>(t: TestApp, url: string): Promise<T> {
  const response = await t.app.inject({ method: 'GET', url });
  expect(response.statusCode, response.body).toBe(200);
  return response.json();
}

describe('master data overview', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
    await t.db
      .insertInto('master_data.article')
      .values([
        // Clean article with a target quantity.
        {
          id: 1,
          description: 'Herrenuhr',
          ean: '4006381333931',
          price_net: '100.00',
          price_gross: '119.00',
          category: 'Uhren',
          expected_quantity: 2,
        },
        // Shares the EAN with 1.
        {
          id: 2,
          description: 'Herrenuhr Doppelt',
          ean: '4006381333931',
          price_net: '50.00',
          price_gross: '59.50',
          category: 'Uhren',
          expected_quantity: 1,
        },
        // Wrong check digit.
        {
          id: 3,
          description: 'Ring',
          ean: '4006381333932',
          price_net: '10.00',
          price_gross: '11.90',
          category: 'Ringe',
        },
        // Neither EAN nor article number, price 0.
        {
          id: 4,
          description: 'Batterie',
          ean: null,
          price_net: '0.00',
          price_gross: '0.00',
          category: null,
          expected_quantity: 10,
        },
        // Gross below net, article number shared with 6.
        {
          id: 5,
          description: 'Kette',
          ean: null,
          price_net: '20.00',
          price_gross: '19.00',
          category: 'Ketten',
          expected_quantity: 0,
        },
        {
          id: 6,
          description: 'Armband',
          ean: '96385074',
          price_net: '30.00',
          price_gross: '35.70',
          category: 'Ketten',
        },
      ])
      .execute();
    await t.db
      .insertInto('master_data.article_number')
      .values([
        { article_id: 5, number: 'K-1' },
        { article_id: 6, number: 'K-1' },
        { article_id: 6, number: 'A-2' },
      ])
      .execute();
  });
  afterAll(() => t.close());

  it('reports key figures and the target stock per category', async () => {
    const overview = await get<MasterDataOverview>(t, '/api/admin/master-data/overview');
    expect(overview).toMatchObject({
      articleCount: 6,
      withEan: 4,
      withArticleNumber: 2,
      withoutExpectedQuantity: 2,
      expected: { articles: 4, quantity: 13, net: '250.00', gross: '297.50' },
    });
    expect(overview.byCategory).toEqual([
      { category: 'Ketten', articleCount: 2, articles: 1, quantity: 0, net: '0.00', gross: '0.00' },
      { category: 'Ringe', articleCount: 1, articles: 0, quantity: 0, net: '0.00', gross: '0.00' },
      {
        category: 'Uhren',
        articleCount: 2,
        articles: 2,
        quantity: 3,
        net: '250.00',
        gross: '297.50',
      },
      { category: null, articleCount: 1, articles: 1, quantity: 10, net: '0.00', gross: '0.00' },
    ]);
  });

  it('runs every check', async () => {
    const { checks } = await get<MasterDataOverview>(t, '/api/admin/master-data/overview');
    const summary = Object.fromEntries(
      checks.map((c) => [c.kind, c.issues.map((i) => [i.article.id, i.code])]),
    );
    expect(summary).toEqual({
      duplicate_ean: [
        [1, '4006381333931'],
        [2, '4006381333931'],
      ],
      duplicate_article_number: [
        [5, 'K-1'],
        [6, 'K-1'],
      ],
      without_code: [[4, null]],
      invalid_ean: [[3, '4006381333932']],
      zero_price: [[4, null]],
      gross_below_net: [[5, null]],
    });
    expect(checks.every((c) => c.count === c.issues.length && !c.truncated)).toBe(true);
    expect(checks[1]!.issues[1]!.article).toEqual({
      id: 6,
      description: 'Armband',
      ean: '96385074',
      articleNumbers: ['A-2', 'K-1'],
      category: 'Ketten',
      priceNet: '30.00',
      priceGross: '35.70',
      expectedQuantity: null,
    });
  });

  it('pages through the articles by description', async () => {
    const page = await get<MasterDataArticlePage>(t, '/api/admin/master-data/articles');
    expect(page.total).toBe(6);
    expect(page.articles.map((a) => a.description)).toEqual([
      'Armband',
      'Batterie',
      'Herrenuhr',
      'Herrenuhr Doppelt',
      'Kette',
      'Ring',
    ]);
    const later = await get<MasterDataArticlePage>(t, '/api/admin/master-data/articles?offset=4');
    expect(later.articles.map((a) => a.id)).toEqual([5, 3]);
  });

  it('searches the articles like the workstation', async () => {
    const byWord = await get<MasterDataArticlePage>(t, '/api/admin/master-data/articles?q=herren');
    expect(byWord.articles.map((a) => a.id).sort()).toEqual([1, 2]);
    expect(byWord.total).toBe(2);
    const byNumber = await get<MasterDataArticlePage>(t, '/api/admin/master-data/articles?q=K-1');
    expect(byNumber.articles.map((a) => a.id).sort()).toEqual([5, 6]);
  });
});

describe('master data overview performance', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
    await seedMasterData(t.db, { count: 100_000, seed: 42, replace: false });
    await sql`ANALYZE master_data.article, master_data.article_number`.execute(t.db);
  }, 300_000);
  afterAll(() => t.close());

  it('loads the overview of 100,000 articles in less than 2 seconds', async () => {
    // A first request warms up the connection and query plans.
    await get<MasterDataOverview>(t, '/api/admin/master-data/overview');
    const start = performance.now();
    const overview = await get<MasterDataOverview>(t, '/api/admin/master-data/overview');
    const page = await get<MasterDataArticlePage>(t, '/api/admin/master-data/articles');
    const elapsed = performance.now() - start;
    expect(overview.articleCount).toBe(100_000);
    expect(overview.checks.find((c) => c.kind === 'duplicate_ean')!.count).toBeGreaterThan(0);
    expect(page.articles).toHaveLength(100);
    expect(elapsed).toBeLessThan(2000);
  }, 60_000);
});
