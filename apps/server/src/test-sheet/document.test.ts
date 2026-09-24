import type { ContentStack, ContentSvg, ContentTable, ContentText } from 'pdfmake/interfaces.js';
import { describe, expect, it } from 'vitest';
import { barcode, NOMINAL_MODULE_MM } from '../pdf/barcode.ts';
import { MM, renderPdf } from '../pdf/render.ts';
import { LABEL_BARCODE_WIDTH_MM, testSheetDocument } from './document.ts';
import type { TestSheet } from './selection.ts';

const sheet: TestSheet = {
  sections: [
    {
      kind: 'unique_ean',
      labels: [
        {
          code: '4006381333931',
          symbology: 'ean13',
          expected: 'unique',
          articles: [
            { description: 'Juwelia Solitärring Weißgold 750, Gr. 54', priceGross: '1234.50' },
          ],
        },
      ],
    },
    { kind: 'unique_article_number', labels: [] },
    {
      kind: 'ambiguous',
      labels: [
        {
          code: 'A-123456',
          symbology: 'code128',
          expected: 'ambiguous',
          articles: [
            { description: 'Ring A', priceGross: '10.00' },
            { description: 'Ring B', priceGross: '20.00' },
          ],
        },
      ],
    },
    {
      kind: 'not_found',
      labels: [{ code: '2000000000008', symbology: 'ean13', expected: 'not_found', articles: [] }],
    },
  ],
};

const info = { createdAt: new Date('2026-09-24T10:00:00Z'), seed: 7, articleCount: 5000 };

function texts(node: unknown): string[] {
  if (typeof node === 'string') return [node];
  if (Array.isArray(node)) return node.flatMap(texts);
  if (typeof node === 'object' && node !== null) {
    return Object.entries(node).flatMap(([key, value]) => (key === 'svg' ? [] : texts(value)));
  }
  return [];
}

describe('testSheetDocument', () => {
  const document = testSheetDocument(sheet, info);
  const allTexts = texts(document.content).join('\n');

  it('contains all section headings and marks empty sections as skipped', () => {
    for (const title of [
      '1. Eindeutig per EAN',
      '2. Eindeutig per Artikelnummer',
      '3. Mehrdeutig',
      '4. Unbekannt',
    ]) {
      expect(allTexts).toContain(title);
    }
    expect(allTexts).toContain(
      'Ausgelassen: Die Stammdaten enthalten dafür keine passenden Artikel.',
    );
  });

  it('shows code, description, gross price and expected result on each label', () => {
    expect(allTexts).toContain('4006381333931');
    expect(allTexts).toContain('Juwelia Solitärring Weißgold 750, Gr. 54');
    expect(allTexts).toContain('1.234,50 €');
    expect(allTexts).toContain('Erwartet: GRÜN (eindeutig)');
    expect(allTexts).toContain('2 Artikel: Ring A · Ring B');
    expect(allTexts).toContain('Erwartet: GELB (mehrdeutig)');
    expect(allTexts).toContain('Nicht in den Stammdaten');
    expect(allTexts).toContain('Erwartet: ROT (unbekannt)');
    expect(allTexts).toContain('Erstellt am 24.09.2026, 12:00 · Startwert 7 · 5.000 Artikel');
  });

  it('lays out labels in a grid of three columns', () => {
    const table = (document.content as unknown[]).find(
      (c): c is ContentTable => typeof c === 'object' && c !== null && 'table' in c,
    )!;
    expect(table.table.widths).toEqual(['*', '*', '*']);
    const [label] = table.table.body[0]! as ContentStack[];
    const [bars, code] = label!.stack as [ContentSvg, ContentText];
    expect(bars.svg).toContain('<svg');
    expect(code.text).toBe('4006381333931');
  });

  it('renders a PDF', async () => {
    const pdf = await renderPdf(document);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1000);
  });
});

describe('barcode', () => {
  it('prints EAN-13 in nominal size (0.33 mm per module, 22.85 mm bars)', () => {
    const { moduleMm, widthMm, content } = barcode(
      '4006381333931',
      'ean13',
      LABEL_BARCODE_WIDTH_MM,
    );
    expect(moduleMm).toBe(NOMINAL_MODULE_MM);
    // 95 modules plus bwip-js' trailing half-module stroke.
    expect(widthMm).toBeCloseTo(96 * 0.33, 5);
    expect(content.height).toBeCloseTo(22.85 * MM, 5);
  });

  it('keeps the quiet zones inside a label for the EAN-13 nominal size', () => {
    const { widthMm } = barcode('4006381333931', 'ean13', LABEL_BARCODE_WIDTH_MM);
    expect(widthMm + (11 + 7) * NOMINAL_MODULE_MM).toBeLessThanOrEqual(LABEL_BARCODE_WIDTH_MM);
  });

  it('shrinks long Code 128 codes to fit including quiet zones', () => {
    const long = barcode('VERY-LONG-ARTICLE-NUMBER-123456', 'code128', LABEL_BARCODE_WIDTH_MM);
    expect(long.moduleMm).toBeLessThan(NOMINAL_MODULE_MM);
    expect(long.widthMm + 20 * long.moduleMm).toBeCloseTo(LABEL_BARCODE_WIDTH_MM, 5);

    const short = barcode('A-123456', 'code128', LABEL_BARCODE_WIDTH_MM);
    expect(short.moduleMm).toBe(NOMINAL_MODULE_MM);
  });
});
