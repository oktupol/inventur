import type { Content, ContentTable, TableCell } from 'pdfmake/interfaces.js';
import { describe, expect, it } from 'vitest';
import { renderPdf } from '../pdf/render.ts';
import { countListDocument, type CountListInfo } from './document.ts';
import { buildWorkAreaCountList, type CountListLine, type WorkAreaCountList } from './model.ts';

const START = Date.parse('2026-09-25T07:00:00Z');

function lines(count: number): CountListLine[] {
  return Array.from({ length: count }, (_, i) => {
    const ms = START + i * 20_000;
    return {
      id: i + 1,
      at: ms * 1000,
      createdAt: new Date(ms),
      description: `Juwelia Ring Gelbgold 585, Gr. ${50 + (i % 10)}`,
      ean: i % 4 === 0 ? null : '4000000000017',
      input: i % 4 === 0 ? `A-${i}` : '4000000000017',
      serialNumber: null,
      quantity: i % 10 === 0 ? 2 : 1,
      priceNet: '100.00',
      priceGross: '119.00',
      isManual: false,
      workstation: 'Kasse',
    };
  });
}

function area(name: string, count: number, checkpointAfter: number[] = []): WorkAreaCountList {
  const all = lines(count);
  return buildWorkAreaCountList({
    name,
    description: null,
    status: 'closed',
    employees: ['Anna', 'Jörg'],
    lines: all,
    checkpoints: checkpointAfter.map((n, i) => ({
      id: i + 1,
      at: all[n - 1]!.at,
      createdAt: all[n - 1]!.createdAt,
      workstation: 'Kasse',
    })),
  });
}

const info: CountListInfo = {
  stocktakeName: 'Inventur 2026',
  createdAt: new Date('2026-09-25T16:00:00Z'),
  scope: 'work_area',
};

function texts(content: Content): string[] {
  return JSON.stringify(content)
    .match(/"text":"[^"]*"/g)!
    .map((match) => (JSON.parse(match.slice(7)) as string).replaceAll('\u00a0', ' '));
}

function positionsTable(content: Content[]): ContentTable {
  return content.find(
    (c): c is ContentTable => typeof c === 'object' && 'table' in c && c.table?.headerRows === 2,
  )!;
}

const cellText = (cell: TableCell | undefined) =>
  cell && typeof cell === 'object' && 'text' in cell && typeof cell.text === 'string'
    ? cell.text.replaceAll('\u00a0', ' ')
    : undefined;

describe('countListDocument', () => {
  it('shows the header data, positions, subtotals, totals and signature fields', () => {
    const doc = countListDocument([area('Vitrine 3', 5, [3])], info);
    const content = doc.content as Content[];
    const all = texts(content);
    expect(all).toEqual(
      expect.arrayContaining(['Zählliste Vitrine 3', 'Inventur 2026', 'Anna, Jörg']),
    );
    expect(all).toEqual(
      expect.arrayContaining(['Gezählt (Zähler)', 'Verantwortlich', 'Unterschrift', 'Datum']),
    );

    const table = positionsTable(content);
    const body = table.table.body;
    expect(table.table.dontBreakRows).toBe(true);
    // Area name and column titles repeat on every page.
    expect(cellText(body[0]![0])).toBe('Arbeitsbereich Vitrine 3');
    expect(body[1]!.map(cellText)).toEqual([
      'Pos.',
      'Zeit',
      'Bezeichnung',
      'EAN / Art.-Nr.',
      'Seriennr.',
      'Menge',
      'Preis brutto',
      'Summe brutto',
    ]);
    expect(body.map((row) => cellText(row[0]))).toEqual([
      'Arbeitsbereich Vitrine 3',
      'Pos.',
      '1',
      '2',
      '3',
      expect.stringMatching(
        /^Zwischensumme Checkpoint 1 \(25\.09\.2026, 09:00, Kasse\): 3 Zeilen$/,
      ),
      'Seit Beginn des Bereichs: 3 Zeilen',
      '4',
      '5',
      'Summe Vitrine 3: 5 Zeilen',
    ]);
    // Checkpoint subtotal: pieces and gross value of lines 1–3.
    expect(body[5]!.map(cellText).slice(5)).toEqual(['4', '', '476,00 €']);
    expect(body.at(-1)!.map(cellText).slice(5)).toEqual(['6', '', '714,00 €']);
    // Articles without EAN show the scanned article number.
    expect(body[2]!.map(cellText).slice(3, 4)).toEqual(['A-0']);
  });

  it('starts the count list of the stocktake with a summary of all work areas', () => {
    const doc = countListDocument([area('Lager', 2), area('Vitrine 3', 3)], {
      ...info,
      scope: 'stocktake',
    });
    const content = doc.content as Content[];
    expect(texts(content)).toEqual(
      expect.arrayContaining(['Zählliste – alle Arbeitsbereiche', 'Summe', '5', '833,00 €']),
    );
    const areaTitles = content.filter(
      (c) => typeof c === 'object' && 'text' in c && String(c.text).startsWith('Zählliste '),
    );
    expect(
      areaTitles.map((c) => [
        (c as { text: string }).text,
        (c as { pageBreak?: string }).pageBreak,
      ]),
    ).toEqual([
      ['Zählliste – alle Arbeitsbereiche', undefined],
      ['Zählliste Lager', 'before'],
      ['Zählliste Vitrine 3', 'before'],
    ]);
  });

  it('writes a single line in the singular', () => {
    const doc = countListDocument([area('Kasse', 1, [1])], info);
    expect(texts(doc.content as Content[])).toEqual(
      expect.arrayContaining(['Seit Beginn des Bereichs: 1 Zeile', 'Summe Kasse: 1 Zeile']),
    );
  });

  it('notes work areas without lines', () => {
    const doc = countListDocument([area('Büro', 0)], info);
    expect(texts(doc.content as Content[])).toContain('Keine Erfassungen.');
  });

  it('breaks several hundred lines across pages', async () => {
    const pdf = await renderPdf(countListDocument([area('Vitrine 3', 400, [100, 250])], info));
    const pages = pdf.toString('latin1').match(/\/Type \/Page\b/g)?.length ?? 0;
    expect(pages).toBeGreaterThanOrEqual(5);
  });
});
