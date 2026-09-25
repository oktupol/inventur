import { describe, expect, it } from 'vitest';
import { entryMatch, mergeArticleHits } from './rules.ts';

const line = {
  serialNumber: 'SN-4711-A',
  ean: '4000000000017',
  description: 'Herrenuhr Automatik Stahl',
  input: 'R-100',
};

describe('entryMatch', () => {
  it('finds a line by the prefix of its serial number, case-insensitively', () => {
    expect(entryMatch(line, 'sn-47')).toBe('serial_number');
    expect(entryMatch(line, '4711')).toBeNull();
  });

  it('finds a line by EAN and input prefix', () => {
    expect(entryMatch(line, '40000')).toBe('ean');
    expect(entryMatch(line, 'r-1')).toBe('input');
  });

  it('finds a line by all words of its description', () => {
    expect(entryMatch(line, 'stahl herren')).toBe('description');
    expect(entryMatch(line, 'stahl gold')).toBeNull();
  });

  it('prefers the EAN over the description', () => {
    expect(entryMatch({ ...line, description: '4000 Serie' }, '4000')).toBe('ean');
  });

  it('needs at least two characters', () => {
    expect(entryMatch(line, ' s ')).toBeNull();
  });

  it('copes with lines without serial number and EAN', () => {
    expect(entryMatch({ ...line, serialNumber: null, ean: null }, 'SN')).toBeNull();
  });
});

describe('mergeArticleHits', () => {
  it('keeps the best match per article', () => {
    const { hits } = mergeArticleHits(
      [
        { articleId: 1, matchedBy: 'description' },
        { articleId: 2, matchedBy: 'description' },
      ],
      [{ articleId: 2, matchedBy: 'serial_number' }],
    );
    expect(hits).toEqual([
      { articleId: 2, matchedBy: 'serial_number' },
      { articleId: 1, matchedBy: 'description' },
    ]);
  });

  it('keeps the order of the master data within a field', () => {
    const { hits } = mergeArticleHits(
      [
        { articleId: 5, matchedBy: 'description' },
        { articleId: 3, matchedBy: 'description' },
      ],
      [{ articleId: 4, matchedBy: 'description' }],
    );
    expect(hits.map((h) => h.articleId)).toEqual([5, 3, 4]);
  });

  it('limits the list and reports more', () => {
    const master = [1, 2, 3].map((articleId) => ({ articleId, matchedBy: 'ean' as const }));
    expect(mergeArticleHits(master, [], 2)).toEqual({
      hits: master.slice(0, 2),
      hasMore: true,
    });
    expect(mergeArticleHits(master, [], 3).hasMore).toBe(false);
  });
});
