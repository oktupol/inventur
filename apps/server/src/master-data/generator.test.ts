import { isValidEan13 } from '@inventur/shared';
import { describe, expect, it } from 'vitest';
import { formatCents, generateMasterData, grossFromNetCents } from './generator.ts';

function countDuplicates(values: string[]): number {
  const seen = new Map<string, number>();
  for (const value of values) seen.set(value, (seen.get(value) ?? 0) + 1);
  return [...seen.values()].filter((n) => n > 1).length;
}

describe('generateMasterData', () => {
  const articles = generateMasterData({ count: 5000, seed: 42 });

  it('generates the requested number of articles with ids 1..n', () => {
    expect(articles).toHaveLength(5000);
    expect(articles.map((a) => a.id)).toEqual(Array.from({ length: 5000 }, (_, i) => i + 1));
  });

  it('is deterministic for the same seed', () => {
    expect(generateMasterData({ count: 5000, seed: 42 })).toEqual(articles);
  });

  it('differs for a different seed', () => {
    expect(generateMasterData({ count: 50, seed: 43 })).not.toEqual(
      generateMasterData({ count: 50, seed: 42 }),
    );
  });

  it('only generates EAN-13 codes with a valid check digit', () => {
    for (const article of articles) {
      if (article.ean !== null) expect(isValidEan13(article.ean), article.ean).toBe(true);
    }
  });

  it('leaves some articles without an EAN', () => {
    const withoutEan = articles.filter((a) => a.ean === null).length;
    expect(withoutEan).toBeGreaterThan(5000 * 0.1);
    expect(withoutEan).toBeLessThan(5000 * 0.2);
  });

  it('assigns 0 to 3 article numbers, covering every count', () => {
    const counts = new Set(articles.map((a) => a.articleNumbers.length));
    expect([...counts].sort()).toEqual([0, 1, 2, 3]);
  });

  it('keeps net prices between 5 and 15,000 euros', () => {
    for (const article of articles) {
      const net = Number(article.priceNet);
      expect(net).toBeGreaterThanOrEqual(5);
      expect(net).toBeLessThanOrEqual(15000);
      expect(article.priceNet).toMatch(/^\d+\.\d{2}$/);
    }
  });

  it('computes the gross price as net × 1.19, rounded half up', () => {
    for (const article of articles) {
      const netCents = Math.round(Number(article.priceNet) * 100);
      expect(article.priceGross).toBe(formatCents(grossFromNetCents(netCents)));
    }
  });

  it('contains deliberate duplicate EANs and article numbers', () => {
    const eans = articles.flatMap((a) => (a.ean ? [a.ean] : []));
    const numbers = articles.flatMap((a) => a.articleNumbers);
    expect(countDuplicates(eans)).toBe(25);
    expect(countDuplicates(numbers)).toBe(25);
  });

  it('contains similar descriptions that share brand, type and material', () => {
    const bases = articles.map((a) => a.description.split(',')[0]!);
    expect(countDuplicates(bases)).toBeGreaterThan(100);
  });

  it('covers all categories', () => {
    expect(new Set(articles.map((a) => a.category))).toEqual(
      new Set(['Armbanduhren', 'Ringe', 'Ketten', 'Ohrschmuck', 'Armbänder', 'Zubehör']),
    );
  });

  it('makes most articles single items, accessories bulk goods and leaves a few without target', () => {
    const quantities = articles.map((a) => a.expectedQuantity);
    const share = (test: (q: number | null) => boolean) =>
      quantities.filter(test).length / quantities.length;
    expect(share((q) => q === 1)).toBeGreaterThan(0.8);
    expect(share((q) => q === null)).toBeGreaterThan(0.005);
    expect(share((q) => q === 0)).toBeGreaterThan(0.005);
    const batteries = articles.filter(
      (a) => a.description.startsWith('Uhrenbatterie') && a.expectedQuantity !== null,
    );
    expect(batteries.filter((a) => a.expectedQuantity! >= 2).length).toBeGreaterThan(0);
    expect(quantities.every((q) => q === null || (Number.isInteger(q) && q >= 0 && q <= 30))).toBe(
      true,
    );
  });

  it('rejects an invalid count', () => {
    expect(() => generateMasterData({ count: 0, seed: 1 })).toThrow('Invalid count');
  });

  it('still generates duplicates for small counts', () => {
    const small = generateMasterData({ count: 20, seed: 1 });
    expect(countDuplicates(small.flatMap((a) => (a.ean ? [a.ean] : [])))).toBeGreaterThan(0);
  });
});

describe('grossFromNetCents', () => {
  it.each([
    [100, 119],
    [1050, 1250], // 12.495 -> 12.50
    [50, 60], // 0.595 -> 0.60
    [1, 1],
  ])('%i cents net yield %i cents gross', (net, gross) => {
    expect(grossFromNetCents(net)).toBe(gross);
  });
});

describe('formatCents', () => {
  it.each([
    [0, '0.00'],
    [5, '0.05'],
    [123456, '1234.56'],
  ])('formats %i as %s', (cents, text) => {
    expect(formatCents(cents)).toBe(text);
  });
});
