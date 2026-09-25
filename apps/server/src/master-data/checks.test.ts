import { describe, expect, it } from 'vitest';
import { duplicatesBy, runChecks, type CheckedArticle } from './checks.ts';

function article(id: number, overrides: Partial<CheckedArticle> = {}): CheckedArticle {
  return { id, ean: null, priceNet: '10.00', priceGross: '11.90', ...overrides };
}

describe('duplicatesBy', () => {
  it('returns the items sharing a key, grouped and ordered by key', () => {
    const items = ['b1', 'a1', 'c1', 'b2', 'a2'];
    expect(duplicatesBy(items, (item) => item[0]!)).toEqual(['a1', 'a2', 'b1', 'b2']);
  });

  it('ignores items without a key', () => {
    expect(duplicatesBy([1, 2], () => null)).toEqual([]);
  });
});

describe('runChecks', () => {
  it('finds articles sharing an EAN', () => {
    const { duplicate_ean } = runChecks(
      [
        article(1, { ean: '4000000000017' }),
        article(2, { ean: '4000000000031' }),
        article(3, { ean: '4000000000017' }),
      ],
      [],
    );
    expect(duplicate_ean).toEqual([
      { articleId: 1, code: '4000000000017' },
      { articleId: 3, code: '4000000000017' },
    ]);
  });

  it('finds article numbers used by several articles', () => {
    const { duplicate_article_number } = runChecks(
      [article(1), article(2)],
      [
        { articleId: 1, number: 'R-1' },
        { articleId: 2, number: 'R-1' },
        { articleId: 2, number: 'R-2' },
      ],
    );
    expect(duplicate_article_number).toEqual([
      { articleId: 1, code: 'R-1' },
      { articleId: 2, code: 'R-1' },
    ]);
  });

  it('finds articles without EAN and article number', () => {
    const { without_code } = runChecks(
      [article(1), article(2, { ean: '4000000000017' }), article(3)],
      [{ articleId: 3, number: 'X' }],
    );
    expect(without_code).toEqual([{ articleId: 1, code: null }]);
  });

  it('finds EAN-8 and EAN-13 with a wrong check digit, not other codes', () => {
    const { invalid_ean } = runChecks(
      [
        article(1, { ean: '4000000000018' }),
        article(2, { ean: '96385075' }),
        article(3, { ean: '4006381333931' }),
        article(4, { ean: '12345' }),
        article(5, { ean: 'ABC-123' }),
      ],
      [],
    );
    expect(invalid_ean).toEqual([
      { articleId: 1, code: '4000000000018' },
      { articleId: 2, code: '96385075' },
    ]);
  });

  it('finds prices of 0 € and gross prices below the net price', () => {
    const checks = runChecks(
      [
        article(1, { priceNet: '0.00', priceGross: '0.00' }),
        article(2, { priceNet: '10.00', priceGross: '0' }),
        article(3, { priceNet: '10.00', priceGross: '9.99' }),
        article(4, { priceNet: '10.00', priceGross: '10.00' }),
      ],
      [],
    );
    expect(checks.zero_price.map((f) => f.articleId)).toEqual([1, 2]);
    expect(checks.gross_below_net.map((f) => f.articleId)).toEqual([2, 3]);
  });

  it('finds nothing in clean data', () => {
    const checks = runChecks(
      [article(1, { ean: '4006381333931' }), article(2)],
      [{ articleId: 2, number: 'R-1' }],
    );
    expect(Object.values(checks).every((findings) => findings.length === 0)).toBe(true);
  });
});
