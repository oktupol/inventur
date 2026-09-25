import type { ArticleMatch, MatchField } from '@inventur/shared';
import { describe, expect, it } from 'vitest';
import { completionFor, matchedText, moveSelection, suggestionCode } from './completion.ts';

function match(matchedBy: MatchField, overrides: Partial<ArticleMatch> = {}): ArticleMatch {
  return {
    id: 1,
    description: 'Herrenring Gold',
    ean: '4000000000017',
    articleNumbers: ['AB-123'],
    category: null,
    priceNet: '1.00',
    priceGross: '1.19',
    matchedBy,
    matchedNumber: matchedBy === 'article_number' ? 'AB-123' : null,
    ...overrides,
  };
}

describe('matchedText', () => {
  it('uses the field that matched', () => {
    expect(matchedText(match('ean'))).toBe('4000000000017');
    expect(matchedText(match('article_number'))).toBe('AB-123');
    expect(matchedText(match('description'))).toBe('Herrenring Gold');
  });
});

describe('suggestionCode', () => {
  it('shows the matched code, or for a description the EAN or first article number', () => {
    expect(suggestionCode(match('ean'))).toBe('4000000000017');
    expect(suggestionCode(match('article_number'))).toBe('AB-123');
    expect(suggestionCode(match('description'))).toBe('4000000000017');
    expect(suggestionCode(match('description', { ean: null }))).toBe('AB-123');
    expect(suggestionCode(match('description', { ean: null, articleNumbers: [] }))).toBe('');
  });
});

describe('completionFor', () => {
  it('completes a single EAN, article number or description prefix', () => {
    expect(completionFor('400000', [match('ean')])).toBe('4000000000017');
    expect(completionFor('ab-1', [match('article_number')])).toBe('ab-123');
    expect(completionFor('herren', [match('description')])).toBe('herrenring Gold');
  });

  it('offers nothing for several suggestions or none', () => {
    expect(completionFor('400', [match('ean'), match('ean', { id: 2 })])).toBeNull();
    expect(completionFor('400', [])).toBeNull();
  });

  it('offers nothing when the input is not a prefix of the match', () => {
    expect(completionFor('gold', [match('description')])).toBeNull();
  });

  it('offers nothing when the input is already complete', () => {
    expect(completionFor('4000000000017', [match('ean')])).toBeNull();
    expect(completionFor('', [match('ean')])).toBeNull();
  });
});

describe('moveSelection', () => {
  it('moves and wraps around', () => {
    expect(moveSelection(0, 1, 3)).toBe(1);
    expect(moveSelection(2, 1, 3)).toBe(0);
    expect(moveSelection(0, -1, 3)).toBe(2);
    expect(moveSelection(0, 1, 0)).toBe(0);
  });
});
