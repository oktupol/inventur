import { describe, expect, it } from 'vitest';
import { reconcile, type ArticleCount, type ReconciliationInput } from './reconciliation.ts';

function article(
  articleId: number,
  expected: number,
  counted: number,
  overrides: Partial<ArticleCount> = {},
): ArticleCount {
  return {
    articleId,
    description: `Artikel ${articleId}`,
    ean: null,
    category: 'Ringe',
    priceNet: '100.00',
    priceGross: '119.00',
    expected,
    counted,
    ...overrides,
  };
}

function input(overrides: Partial<ReconciliationInput>): ReconciliationInput {
  return {
    stocktakeId: 3,
    articleCount: 10,
    expectedQuantity: 25,
    withoutTargetCount: 2,
    shortage: { byCategory: [], articles: [] },
    excess: [],
    unknown: [],
    manual: [],
    ...overrides,
  };
}

describe('reconcile', () => {
  it('passes on the target figures of the master data', () => {
    const result = reconcile(input({}));
    expect(result).toMatchObject({ articleCount: 10, expectedQuantity: 25, withoutTargetCount: 2 });
    expect(result.shortage).toEqual({
      count: 0,
      quantity: 0,
      net: '0.00',
      gross: '0.00',
      byCategory: [],
      articles: [],
      truncated: false,
    });
    expect(result.surplus).toEqual({ quantity: 0, net: '0.00', gross: '0.00', items: [] });
  });

  it('lists articles counted less often than their target with the missing pieces and values', () => {
    const result = reconcile(
      input({
        shortage: {
          byCategory: [],
          articles: [
            article(1, 1, 0),
            article(2, 10, 4, { priceNet: '0.10', priceGross: '0.12', category: 'Zubehör' }),
            // Matching or exceeding the target is no shortage.
            article(3, 2, 2),
            article(4, 1, 3),
          ],
        },
      }),
    );
    expect(result.shortage.articles).toEqual([
      {
        articleId: 1,
        description: 'Artikel 1',
        ean: null,
        category: 'Ringe',
        priceNet: '100.00',
        priceGross: '119.00',
        expected: 1,
        counted: 0,
        missing: 1,
        net: '100.00',
        gross: '119.00',
      },
      expect.objectContaining({
        articleId: 2,
        expected: 10,
        counted: 4,
        missing: 6,
        net: '0.60',
        gross: '0.72',
      }),
    ]);
  });

  it('sums the shortage over its categories, without category last', () => {
    const result = reconcile(
      input({
        shortage: {
          byCategory: [
            { category: null, count: 1, quantity: 1, net: '1.00', gross: '1.19' },
            { category: 'Ringe', count: 2, quantity: 2, net: '200.00', gross: '238.00' },
            { category: 'Zubehör', count: 1, quantity: 6, net: '0.60', gross: '0.72' },
          ],
          articles: [],
        },
      }),
    );
    expect(result.shortage).toMatchObject({
      count: 4,
      quantity: 9,
      net: '201.60',
      gross: '239.91',
    });
    expect(result.shortage.byCategory.map((c) => c.category)).toEqual(['Ringe', 'Zubehör', null]);
  });

  it('limits the shortage list and marks it as truncated', () => {
    const articles = Array.from({ length: 4 }, (_, i) => article(i + 1, 1, 0));
    const shortage = {
      byCategory: [{ category: 'Ringe', count: 4, quantity: 4, net: '400.00', gross: '476.00' }],
      articles,
    };
    const truncated = reconcile(input({ shortage, listLimit: 3 })).shortage;
    expect(truncated.count).toBe(4);
    expect(truncated.articles.map((a) => a.articleId)).toEqual([1, 2, 3]);
    expect(truncated.truncated).toBe(true);
    const complete = reconcile(input({ shortage, listLimit: 4 })).shortage;
    expect(complete.articles).toHaveLength(4);
    expect(complete.truncated).toBe(false);
  });

  it('reports articles counted more often than their target as surplus beyond the target', () => {
    const result = reconcile(
      input({
        excess: [
          article(1, 1, 3, { ean: '4000000000017' }),
          article(2, 10, 12, { description: 'Batterie', priceNet: '1.00', priceGross: '1.19' }),
          article(3, 0, 1, { description: 'Verkaufter Ring' }),
          // Within the target: ignored.
          article(4, 5, 5),
        ],
      }),
    );
    expect(result.surplus.items).toEqual([
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
      expect.objectContaining({
        description: 'Batterie',
        expected: 10,
        counted: 12,
        surplus: 2,
        net: '2.00',
      }),
      expect.objectContaining({ description: 'Verkaufter Ring', expected: 0, counted: 1 }),
    ]);
    expect(result.surplus).toMatchObject({ quantity: 5, net: '302.00', gross: '359.38' });
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
        excess: [article(1, 1, 2, { description: 'Uhr' })],
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
    expect(result.surplus).toMatchObject({ quantity: 4, net: '100.00', gross: '184.50' });
  });
});
