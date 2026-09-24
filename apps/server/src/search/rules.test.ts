import type { ArticleMatch, MatchField } from '@inventur/shared';
import { describe, expect, it } from 'vitest';
import {
  descriptionWords,
  escapeLike,
  normalizeQuery,
  rankMatches,
  resolve,
  toSearchResponse,
  usesTrigramIndex,
} from './rules.ts';

function match(id: number, description: string, matchedBy: MatchField): ArticleMatch {
  return {
    id,
    description,
    ean: null,
    articleNumbers: [],
    category: null,
    priceNet: '1.00',
    priceGross: '1.19',
    matchedBy,
    matchedNumber: null,
  };
}

describe('query parsing', () => {
  it('normalizes whitespace', () => {
    expect(normalizeQuery('  Ring   Gold ')).toBe('Ring Gold');
  });

  it('splits the description search into distinct lower-case words', () => {
    expect(descriptionWords(' Ring gold RING ')).toEqual(['ring', 'gold']);
    expect(descriptionWords('   ')).toEqual([]);
  });

  it('knows when the trigram index can be used', () => {
    expect(usesTrigramIndex(['ri'])).toBe(false);
    expect(usesTrigramIndex(['ri', 'go'])).toBe(false);
    expect(usesTrigramIndex(['ri', 'gold'])).toBe(true);
  });

  it('escapes LIKE wildcards', () => {
    expect(escapeLike('10%_a\\b')).toBe('10\\%\\_a\\\\b');
  });
});

describe('rankMatches', () => {
  it('orders EAN before article number before description, then by description', () => {
    const ranked = rankMatches([
      match(1, 'Zeta', 'description'),
      match(2, 'Beta', 'article_number'),
      match(3, 'Alpha', 'description'),
      match(4, 'Omega', 'ean'),
    ]);
    expect(ranked.map((m) => m.id)).toEqual([4, 2, 3, 1]);
  });

  it('keeps the best match per article', () => {
    const ranked = rankMatches([match(1, 'Ring', 'description'), match(1, 'Ring', 'ean')]);
    expect(ranked).toEqual([match(1, 'Ring', 'ean')]);
  });
});

describe('toSearchResponse', () => {
  it('limits the results and reports more', () => {
    const matches = Array.from({ length: 5 }, (_, i) => match(i, `A${i}`, 'description'));
    const response = toSearchResponse(matches, false, 3);
    expect(response.articles.map((m) => m.id)).toEqual([0, 1, 2]);
    expect(response.hasMore).toBe(true);
    expect(toSearchResponse(matches, false, 5).hasMore).toBe(false);
  });
});

describe('resolve', () => {
  it('is not found without matches', () => {
    expect(resolve(toSearchResponse([], false)).result).toBe('not_found');
  });

  it('is unique with exactly one match', () => {
    expect(resolve(toSearchResponse([match(1, 'Ring', 'ean')], true)).result).toBe('unique');
    expect(resolve(toSearchResponse([match(1, 'Ring', 'description')], false)).result).toBe(
      'unique',
    );
  });

  it('is ambiguous with several matches', () => {
    const response = toSearchResponse([match(1, 'A', 'ean'), match(2, 'B', 'ean')], true);
    expect(resolve(response)).toMatchObject({ result: 'ambiguous', exact: true });
  });

  it('is ambiguous when the only shown match is not the only one', () => {
    const response = toSearchResponse([match(1, 'A', 'ean'), match(2, 'B', 'ean')], false, 1);
    expect(resolve(response).result).toBe('ambiguous');
  });
});
