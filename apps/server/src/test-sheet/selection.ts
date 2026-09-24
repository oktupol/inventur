import { ean13, isValidEan13 } from '@inventur/shared';
import { Random } from '../master-data/random.ts';

export interface SheetArticle {
  id: number;
  description: string;
  ean: string | null;
  priceGross: string;
  articleNumbers: string[];
}

export type Symbology = 'ean13' | 'code128';
export type ExpectedResult = 'unique' | 'ambiguous' | 'not_found';
export type SectionKind = 'unique_ean' | 'unique_article_number' | 'ambiguous' | 'not_found';

export interface Label {
  code: string;
  symbology: Symbology;
  expected: ExpectedResult;
  /** The articles the code resolves to; empty for unknown codes. */
  articles: { description: string; priceGross: string }[];
}

export interface Section {
  kind: SectionKind;
  labels: Label[];
}

export interface TestSheet {
  sections: Section[];
}

export interface SelectionOptions {
  /** Labels per section. */
  count: number;
  seed: number;
}

/** Code 128 (code set B) covers printable ASCII. */
const PRINTABLE_ASCII = /^[\x20-\x7e]+$/;

/**
 * Index of exact matches: lowercase code → ids of the articles with that EAN
 * or article number. A scanned code resolves the same way: an exact match on
 * EAN or article number wins, case-insensitively.
 */
function buildIndex(articles: readonly SheetArticle[]): Map<string, Set<number>> {
  const index = new Map<string, Set<number>>();
  const add = (code: string, id: number) => {
    const key = code.toLowerCase();
    let ids = index.get(key);
    if (!ids) index.set(key, (ids = new Set()));
    ids.add(id);
  };
  for (const article of articles) {
    if (article.ean !== null) add(article.ean, article.id);
    for (const number of article.articleNumbers) add(number, article.id);
  }
  return index;
}

function symbologyFor(code: string): Symbology | null {
  if (isValidEan13(code)) return 'ean13';
  return PRINTABLE_ASCII.test(code) ? 'code128' : null;
}

function describe(article: SheetArticle) {
  return { description: article.description, priceGross: article.priceGross };
}

/**
 * Picks the labels of the barcode test sheet from the current master data.
 * The same master data and seed yield the same sheet.
 */
export function selectTestSheet(
  articles: readonly SheetArticle[],
  { count, seed }: SelectionOptions,
): TestSheet {
  const random = new Random(seed);
  const index = buildIndex(articles);
  const byId = new Map(articles.map((a) => [a.id, a]));
  const resolves = (code: string) => index.get(code.toLowerCase())?.size ?? 0;
  const pick = <T>(candidates: T[]) => random.shuffle(candidates).slice(0, count);

  const uniqueEan: Label[] = articles
    .filter((a) => a.ean !== null && isValidEan13(a.ean) && resolves(a.ean) === 1)
    .map((a) => ({
      code: a.ean!,
      symbology: 'ean13',
      expected: 'unique',
      articles: [describe(a)],
    }));

  const uniqueArticleNumber: Label[] = articles.flatMap((a): Label[] => {
    if (a.ean !== null) return [];
    const number = a.articleNumbers.find((n) => PRINTABLE_ASCII.test(n) && resolves(n) === 1);
    return number
      ? [{ code: number, symbology: 'code128', expected: 'unique', articles: [describe(a)] }]
      : [];
  });

  const ambiguous: Label[] = [];
  const seen = new Set<string>();
  for (const article of articles) {
    for (const code of [article.ean, ...article.articleNumbers]) {
      if (code === null || seen.has(code.toLowerCase()) || resolves(code) < 2) continue;
      seen.add(code.toLowerCase());
      const symbology = symbologyFor(code);
      if (!symbology) continue;
      const matches = [...index.get(code.toLowerCase())!].map((id) => describe(byId.get(id)!));
      ambiguous.push({ code, symbology, expected: 'ambiguous', articles: matches });
    }
  }

  return {
    sections: [
      { kind: 'unique_ean', labels: pick(uniqueEan) },
      { kind: 'unique_article_number', labels: pick(uniqueArticleNumber) },
      { kind: 'ambiguous', labels: pick(ambiguous) },
      // Own generator, so the unknown codes only depend on the seed.
      { kind: 'not_found', labels: unknownCodes(articles, index, new Random(seed + 1), count) },
    ],
  };
}

/**
 * Generates valid EAN-13 codes that yield no search result at all: no exact
 * match, no EAN or article number starting with the code and no description
 * containing it. Prefix 2 (restricted circulation) makes collisions unlikely;
 * the checks guarantee there are none.
 */
function unknownCodes(
  articles: readonly SheetArticle[],
  index: Map<string, Set<number>>,
  random: Random,
  count: number,
): Label[] {
  const codes = [...index.keys()];
  const descriptions = articles.map((a) => a.description.toLowerCase());
  const labels: Label[] = [];
  const taken = new Set<string>();
  while (labels.length < count) {
    const code = ean13(`2${random.digits(11)}`);
    if (
      taken.has(code) ||
      codes.some((existing) => existing.startsWith(code)) ||
      descriptions.some((description) => description.includes(code))
    ) {
      continue;
    }
    taken.add(code);
    labels.push({ code, symbology: 'ean13', expected: 'not_found', articles: [] });
  }
  return labels;
}
