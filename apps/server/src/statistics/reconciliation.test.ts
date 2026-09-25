import { describe, expect, it } from 'vitest';
import { reconcile, type ArticleCount, type ReconciliationInput } from './reconciliation.ts';

function article(articleId: number, counted: number, overrides: Partial<ArticleCount> = {}) {
  return {
    articleId,
    description: `Artikel ${articleId}`,
    ean: null,
    category: 'Ringe',
    priceNet: '100.00',
    priceGross: '119.00',
    counted,
    ...overrides,
  };
}

function input(overrides: Partial<ReconciliationInput>): ReconciliationInput {
  return {
    stocktakeId: 3,
    articleCount: 10,
    shortage: { byCategory: [], articles: [] },
    counted: [],
    unknown: [],
    manual: [],
    ...overrides,
  };
}

describe('reconcile', () => {
  it('treats articles counted exactly once as matching the target', () => {
    const result = reconcile(input({ counted: [article(1, 1), article(2, 1)] }));
    expect(result.shortage).toEqual({
      count: 0,
      net: '0.00',
      gross: '0.00',
      byCategory: [],
      articles: [],
      truncated: false,
    });
    expect(result.surplus).toEqual({ quantity: 0, net: '0.00', gross: '0.00', items: [] });
    expect(result.articleCount).toBe(10);
  });

  it('sums the shortage over its categories, without category last', () => {
    const result = reconcile(
      input({
        shortage: {
          byCategory: [
            { category: null, count: 1, net: '1.00', gross: '1.19' },
            { category: 'Ringe', count: 2, net: '200.00', gross: '238.00' },
            { category: 'Armbänder', count: 1, net: '0.10', gross: '0.12' },
          ],
          articles: [],
        },
      }),
    );
    expect(result.shortage).toMatchObject({ count: 4, net: '201.10', gross: '239.31' });
    expect(result.shortage.byCategory.map((c) => c.category)).toEqual(['Armbänder', 'Ringe', null]);
  });

  it('limits the shortage list and marks it as truncated', () => {
    const articles = Array.from({ length: 4 }, (_, i) => ({
      articleId: i + 1,
      description: `Artikel ${i + 1}`,
      ean: null,
      category: 'Ringe',
      priceNet: '100.00',
      priceGross: '119.00',
    }));
    const shortage = {
      byCategory: [{ category: 'Ringe', count: 4, net: '400.00', gross: '476.00' }],
      articles,
    };
    const truncated = reconcile(input({ shortage, listLimit: 3 })).shortage;
    expect(truncated.count).toBe(4);
    expect(truncated.articles.map((a) => a.articleId)).toEqual([1, 2, 3]);
    expect(truncated.truncated).toBe(true);
    const complete = reconcile(input({ shortage, listLimit: 4 })).shortage;
    expect(complete.articles).toEqual(articles);
    expect(complete.truncated).toBe(false);
  });

  it('reports articles counted more than once as surplus beyond the target of 1', () => {
    const result = reconcile(input({ counted: [article(1, 3, { ean: '4000000000017' })] }));
    expect(result.surplus).toEqual({
      quantity: 2,
      net: '200.00',
      gross: '238.00',
      items: [
        {
          kind: 'excess',
          articleId: 1,
          entryId: null,
          description: 'Artikel 1',
          ean: '4000000000017',
          category: 'Ringe',
          priceNet: '100.00',
          priceGross: '119.00',
          expected: 1,
          counted: 3,
          surplus: 2,
          net: '200.00',
          gross: '238.00',
        },
      ],
    });
  });

  it('reports captured articles missing from the master data as surplus', () => {
    const result = reconcile(
      input({
        unknown: [
          {
            articleId: 9,
            description: 'Alter Ring',
            ean: null,
            category: 'Ringe',
            priceNet: '10.00',
            priceGross: '11.90',
            counted: 2,
          },
        ],
      }),
    );
    expect(result.surplus.items).toEqual([
      expect.objectContaining({
        kind: 'unknown',
        articleId: 9,
        expected: 0,
        counted: 2,
        surplus: 2,
        net: '20.00',
        gross: '23.80',
      }),
    ]);
  });

  it('reports every manual line as surplus without a net value', () => {
    const result = reconcile(
      input({
        counted: [article(1, 2, { description: 'Uhr' })],
        manual: [
          { entryId: 20, description: 'Brosche', priceGross: '30.00', quantity: 2 },
          { entryId: 21, description: 'Anhänger', priceGross: '5.50', quantity: 1 },
        ],
      }),
    );
    expect(result.surplus.items.map((item) => [item.kind, item.description])).toEqual([
      ['excess', 'Uhr'],
      ['manual', 'Brosche'],
      ['manual', 'Anhänger'],
    ]);
    expect(result.surplus.items[1]).toEqual({
      kind: 'manual',
      articleId: null,
      entryId: 20,
      description: 'Brosche',
      ean: null,
      category: null,
      priceNet: null,
      priceGross: '30.00',
      expected: 0,
      counted: 2,
      surplus: 2,
      net: null,
      gross: '60.00',
    });
    expect(result.surplus.quantity).toBe(4);
    expect(result.surplus.net).toBe('100.00');
    expect(result.surplus.gross).toBe('184.50');
  });
});
