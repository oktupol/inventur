import type { ArticleResolution, ArticleSearchResponse } from '@inventur/shared';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../test/app.ts';
import { seedMasterData } from '../master-data/seed.ts';
import { resolveArticle, searchArticles } from './service.ts';

interface Fixture {
  id: number;
  description: string;
  ean: string | null;
  numbers?: string[];
}

const FIXTURES: Fixture[] = [
  { id: 1, description: 'Herrenring Gold 585', ean: '4000000000017', numbers: ['A-100200'] },
  { id: 2, description: 'Damenring Gold 750', ean: '4000000000024', numbers: ['A-100201'] },
  { id: 3, description: 'Kette Silber', ean: '4000000000031' },
  { id: 4, description: 'Kette Silber lang', ean: '4000000000031' },
  { id: 5, description: 'Uhr 100% Edelstahl', ean: null, numbers: ['X_1', 'SHARED-1'] },
  { id: 6, description: 'Armband Leder', ean: null, numbers: ['SHARED-1'] },
  { id: 7, description: 'Ohrstecker', ean: null, numbers: ['R-1'] },
  { id: 8, description: 'Ohrhänger', ean: null, numbers: ['R-10'] },
  ...Array.from({ length: 25 }, (_, i) => ({
    id: 100 + i,
    description: `Batterie CR2032 Nr. ${String(i).padStart(2, '0')}`,
    ean: null,
  })),
];

describe('article search', () => {
  let t: TestApp;
  let token: string;

  beforeAll(async () => {
    t = await createTestApp();
    await t.db
      .insertInto('master_data.article')
      .values(
        FIXTURES.map(({ id, description, ean }) => ({
          id,
          description,
          ean,
          price_net: '10.00',
          price_gross: '11.90',
          category: 'Test',
        })),
      )
      .execute();
    await t.db
      .insertInto('master_data.article_number')
      .values(
        FIXTURES.flatMap(({ id, numbers = [] }) =>
          numbers.map((number) => ({ article_id: id, number })),
        ),
      )
      .execute();
    token = (
      await t.app.inject({
        method: 'POST',
        url: '/api/station/register',
        payload: { name: 'Kasse' },
      })
    ).json().token;
  });
  afterAll(() => t.close());

  const ids = async (query: string) =>
    (await searchArticles(t.db, query)).articles.map((a) => a.id);

  describe('by EAN', () => {
    it('matches a prefix', async () => {
      expect(await ids('400000000')).toEqual([2, 1, 3, 4]);
    });

    it('returns only the exact match, marked as exact', async () => {
      const response = await searchArticles(t.db, '4000000000017');
      expect(response.exact).toBe(true);
      expect(response.articles).toMatchObject([
        {
          id: 1,
          description: 'Herrenring Gold 585',
          ean: '4000000000017',
          articleNumbers: ['A-100200'],
          category: 'Test',
          priceNet: '10.00',
          priceGross: '11.90',
          matchedBy: 'ean',
        },
      ]);
    });

    it('returns all articles sharing an exact EAN', async () => {
      expect(await ids('4000000000031')).toEqual([3, 4]);
    });

    it('ignores surrounding whitespace, e.g. from scanners', async () => {
      expect(await ids(' 4000000000017 ')).toEqual([1]);
    });
  });

  describe('by article number', () => {
    it('matches a prefix, ignoring case', async () => {
      const response = await searchArticles(t.db, 'a-1002');
      expect(response.articles.map((a) => [a.id, a.matchedNumber])).toEqual([
        [2, 'A-100201'],
        [1, 'A-100200'],
      ]);
      expect(response.exact).toBe(false);
    });

    it('prefers the exact number over longer numbers with the same prefix', async () => {
      const response = await searchArticles(t.db, 'r-1');
      expect(response.exact).toBe(true);
      expect(response.articles.map((a) => a.id)).toEqual([7]);
    });

    it('returns all articles sharing an exact number', async () => {
      expect(await ids('shared-1')).toEqual([6, 5]);
    });

    it('treats LIKE wildcards literally', async () => {
      expect(await ids('X_')).toEqual([5]);
      expect(await ids('_')).toEqual([]);
    });
  });

  describe('by description', () => {
    it('requires all words as substrings in any order, ignoring case', async () => {
      expect(await ids('gold RING')).toEqual([2, 1]);
      expect(await ids('585 gold herrenring')).toEqual([1]);
      expect(await ids('ring platin')).toEqual([]);
    });

    it('finds substrings inside words', async () => {
      expect(await ids('ette')).toEqual([3, 4]);
      expect(await ids('hänger')).toEqual([8]);
    });

    it('treats a percent sign literally', async () => {
      expect(await ids('100%')).toEqual([5]);
      expect(await ids('%')).toEqual([5]);
    });

    it('ranks EAN and article number matches before description matches', async () => {
      await sql`INSERT INTO master_data.article_number VALUES (6, 'KETTE-9')`.execute(t.db);
      try {
        expect(await ids('kette')).toEqual([6, 3, 4]);
      } finally {
        await sql`DELETE FROM master_data.article_number WHERE number = 'KETTE-9'`.execute(t.db);
      }
    });
  });

  it('returns at most 20 matches and reports more', async () => {
    const response = await searchArticles(t.db, 'batterie');
    expect(response.articles).toHaveLength(20);
    expect(response.hasMore).toBe(true);
    expect(response.articles[0]!.description).toBe('Batterie CR2032 Nr. 00');
  });

  it('returns nothing for an empty query', async () => {
    expect(await searchArticles(t.db, '   ')).toEqual({
      articles: [],
      exact: false,
      hasMore: false,
    });
  });

  describe('resolving a confirmed input', () => {
    it.each([
      ['4000000000017', 'unique', [1]],
      ['585 gold', 'unique', [1]],
      ['r-1', 'unique', [7]],
      ['4000000000031', 'ambiguous', [3, 4]],
      ['shared-1', 'ambiguous', [6, 5]],
      ['gold', 'ambiguous', [2, 1]],
      ['4000000000048', 'not_found', []],
      ['platin', 'not_found', []],
    ] as const)('%s is %s', async (query, result, expected) => {
      const resolution = await resolveArticle(t.db, query);
      expect(resolution.result).toBe(result);
      expect(resolution.articles.map((a) => a.id)).toEqual(expected);
    });

    it('is ambiguous when more than 20 articles match', async () => {
      expect((await resolveArticle(t.db, 'batterie')).result).toBe('ambiguous');
    });
  });

  describe('HTTP API', () => {
    it('searches and resolves for registered workstations', async () => {
      const search = await t.app.inject({
        method: 'GET',
        url: '/api/station/articles/search?q=gold',
        headers: { 'x-workstation-token': token },
      });
      expect((search.json() as ArticleSearchResponse).articles.map((a) => a.id)).toEqual([2, 1]);
      const resolve = await t.app.inject({
        method: 'GET',
        url: `/api/station/articles/resolve?q=${encodeURIComponent('Herrenring gold')}`,
        headers: { 'x-workstation-token': token },
      });
      expect((resolve.json() as ArticleResolution).result).toBe('unique');
    });

    it('requires a workstation token and a query', async () => {
      const anonymous = await t.app.inject({
        method: 'GET',
        url: '/api/station/articles/search?q=x',
      });
      expect(anonymous.statusCode).toBe(401);
      const missing = await t.app.inject({
        method: 'GET',
        url: '/api/station/articles/search',
        headers: { 'x-workstation-token': token },
      });
      expect(missing.statusCode).toBe(400);
    });
  });
});

describe('article search performance', () => {
  let t: TestApp;
  let token: string;
  let sample: { ean: string; number: string; description: string };

  beforeAll(async () => {
    t = await createTestApp();
    await seedMasterData(t.db, { count: 100_000, seed: 42, replace: false });
    await sql`ANALYZE master_data.article, master_data.article_number`.execute(t.db);
    const article = await t.db
      .selectFrom('master_data.article as a')
      .innerJoin('master_data.article_number as n', 'n.article_id', 'a.id')
      .select(['a.ean', 'n.number', 'a.description'])
      .where('a.ean', 'is not', null)
      .where('a.id', '=', 50_000)
      .executeTakeFirst();
    const fallback = await t.db
      .selectFrom('master_data.article as a')
      .innerJoin('master_data.article_number as n', 'n.article_id', 'a.id')
      .select(['a.ean', 'n.number', 'a.description'])
      .where('a.ean', 'is not', null)
      .executeTakeFirstOrThrow();
    const found = article ?? fallback;
    sample = { ean: found.ean!, number: found.number, description: found.description };
    token = (
      await t.app.inject({
        method: 'POST',
        url: '/api/station/register',
        payload: { name: 'Kasse' },
      })
    ).json().token;
  }, 300_000);
  afterAll(() => t.close());

  it('answers every kind of query over 100,000 articles in less than 200 ms', async () => {
    const words = sample.description.split(' ');
    const queries = [
      sample.ean,
      sample.ean.slice(0, 6),
      sample.number,
      sample.number.slice(0, 4),
      sample.description,
      `${words[0]} ${words.at(-1)}`,
      'ri',
      'gold ring',
      'xyz unbekannt',
      '4099999999999',
    ];
    const search = (q: string) =>
      t.app.inject({
        method: 'GET',
        url: `/api/station/articles/search?q=${encodeURIComponent(q)}`,
        headers: { 'x-workstation-token': token },
      });
    for (const q of queries) await search(q); // warm up connections and caches

    const timings: Record<string, number> = {};
    for (const q of queries) {
      const start = performance.now();
      const response = await search(q);
      timings[q] = Math.round(performance.now() - start);
      expect(response.statusCode).toBe(200);
    }
    for (const [q, ms] of Object.entries(timings)) {
      expect(ms, `query "${q}" took ${ms} ms`).toBeLessThan(200);
    }
    expect((await searchArticles(t.db, sample.ean)).exact).toBe(true);
  });
});
