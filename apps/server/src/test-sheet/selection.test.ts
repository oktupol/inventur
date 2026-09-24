import { isValidEan13 } from '@inventur/shared';
import { describe, expect, it } from 'vitest';
import { generateMasterData } from '../master-data/generator.ts';
import { selectTestSheet, type Section, type SectionKind, type SheetArticle } from './selection.ts';

const masterData: SheetArticle[] = generateMasterData({ count: 3000, seed: 42 }).map((a) => ({
  id: a.id,
  description: a.description,
  ean: a.ean,
  priceGross: a.priceGross,
  articleNumbers: a.articleNumbers,
}));

/** Articles whose EAN or article number matches the code exactly, ignoring case. */
function exactMatches(articles: SheetArticle[], code: string): SheetArticle[] {
  const key = code.toLowerCase();
  return articles.filter(
    (a) => a.ean?.toLowerCase() === key || a.articleNumbers.some((n) => n.toLowerCase() === key),
  );
}

function section(sections: Section[], kind: SectionKind): Section {
  return sections.find((s) => s.kind === kind)!;
}

function article(id: number, ean: string | null, articleNumbers: string[] = []): SheetArticle {
  return { id, description: `Artikel ${id}`, ean, priceGross: '10.00', articleNumbers };
}

describe('selectTestSheet', () => {
  const sheet = selectTestSheet(masterData, { count: 12, seed: 7 });

  it('returns the four sections in order with the requested number of labels', () => {
    expect(sheet.sections.map((s) => s.kind)).toEqual([
      'unique_ean',
      'unique_article_number',
      'ambiguous',
      'not_found',
    ]);
    for (const s of sheet.sections.slice(0, 2)) expect(s.labels).toHaveLength(12);
    expect(section(sheet.sections, 'not_found').labels).toHaveLength(12);
  });

  it('is deterministic for the same seed and differs for another seed', () => {
    expect(selectTestSheet(masterData, { count: 12, seed: 7 })).toEqual(sheet);
    expect(selectTestSheet(masterData, { count: 12, seed: 8 })).not.toEqual(sheet);
  });

  it('picks EAN-13 codes that resolve to exactly one article', () => {
    for (const label of section(sheet.sections, 'unique_ean').labels) {
      expect(label).toMatchObject({ symbology: 'ean13', expected: 'unique' });
      expect(isValidEan13(label.code)).toBe(true);
      const matches = exactMatches(masterData, label.code);
      expect(matches).toHaveLength(1);
      expect(label.articles).toEqual([
        { description: matches[0]!.description, priceGross: matches[0]!.priceGross },
      ]);
    }
  });

  it('picks article numbers of articles without EAN that resolve to exactly one article', () => {
    for (const label of section(sheet.sections, 'unique_article_number').labels) {
      expect(label).toMatchObject({ symbology: 'code128', expected: 'unique' });
      const matches = exactMatches(masterData, label.code);
      expect(matches).toHaveLength(1);
      expect(matches[0]!.ean).toBeNull();
    }
  });

  it('picks codes that resolve to several articles and lists all of them', () => {
    const labels = section(sheet.sections, 'ambiguous').labels;
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.some((l) => l.symbology === 'ean13')).toBe(true);
    expect(labels.some((l) => l.symbology === 'code128')).toBe(true);
    for (const label of labels) {
      expect(label.expected).toBe('ambiguous');
      const matches = exactMatches(masterData, label.code);
      expect(matches.length).toBeGreaterThanOrEqual(2);
      expect(label.articles).toHaveLength(matches.length);
    }
  });

  it('generates unknown codes that never occur in the master data', () => {
    const labels = section(sheet.sections, 'not_found').labels;
    expect(new Set(labels.map((l) => l.code)).size).toBe(12);
    for (const label of labels) {
      expect(label).toMatchObject({ symbology: 'ean13', expected: 'not_found', articles: [] });
      expect(isValidEan13(label.code)).toBe(true);
      expect(exactMatches(masterData, label.code)).toEqual([]);
    }
  });

  it('never picks an unknown code that exists as EAN, article number, prefix or in a description', () => {
    // Put exactly the codes the generator would pick first into the master data.
    const first = selectTestSheet([], { count: 3, seed: 1 }).sections[3]!.labels.map((l) => l.code);
    const [asEan, asNumber, asPrefix] = first as [string, string, string];
    const colliding: SheetArticle[] = [
      article(1, asEan),
      article(2, null, [asNumber.toLowerCase()]),
      article(3, null, [`${asPrefix}-X`]),
      { ...article(4, null), description: `Ring ${first[0]} Gold` },
    ];

    const labels = selectTestSheet(colliding, { count: 3, seed: 1 }).sections[3]!.labels;

    expect(labels).toHaveLength(3);
    // Unknown codes only depend on the seed: without the colliding data they are unchanged.
    expect(
      selectTestSheet([article(9, null)], { count: 3, seed: 1 }).sections[3]!.labels.map(
        (l) => l.code,
      ),
    ).toEqual(first);
    for (const { code } of labels) expect(first).not.toContain(code);
  });

  it('treats article numbers case-insensitively', () => {
    const articles = [article(1, null, ['AB-1']), article(2, null, ['ab-1'])];
    const result = selectTestSheet(articles, { count: 5, seed: 1 });
    expect(section(result.sections, 'unique_article_number').labels).toEqual([]);
    expect(section(result.sections, 'ambiguous').labels).toHaveLength(1);
  });

  it('treats an EAN that equals another article number as ambiguous', () => {
    const ean = '4006381333931';
    const articles = [article(1, ean), article(2, null, [ean])];
    const result = selectTestSheet(articles, { count: 5, seed: 1 });
    expect(section(result.sections, 'unique_ean').labels).toEqual([]);
    expect(section(result.sections, 'ambiguous').labels).toMatchObject([
      { code: ean, symbology: 'ean13', articles: [{}, {}] },
    ]);
  });

  it('leaves sections empty when the master data has no matching articles', () => {
    const articles = [article(1, '4006381333931'), article(2, '4012345678901')];
    const result = selectTestSheet(articles, { count: 5, seed: 1 });
    expect(section(result.sections, 'unique_ean').labels).toHaveLength(2);
    expect(section(result.sections, 'unique_article_number').labels).toEqual([]);
    expect(section(result.sections, 'ambiguous').labels).toEqual([]);
    expect(section(result.sections, 'not_found').labels).toHaveLength(5);
  });

  it('skips EANs without a valid check digit and codes Code 128 cannot encode', () => {
    const articles = [article(1, '4006381333932'), article(2, null, ['Ä-1'])];
    const result = selectTestSheet(articles, { count: 5, seed: 1 });
    expect(section(result.sections, 'unique_ean').labels).toEqual([]);
    expect(section(result.sections, 'unique_article_number').labels).toEqual([]);
  });
});
