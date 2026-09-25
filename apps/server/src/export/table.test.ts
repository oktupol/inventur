import type { Reconciliation } from '@inventur/shared';
import { describe, expect, it } from 'vitest';
import { articleTable, entryTable, reconciliationTable, type ExportEntry } from './table.ts';

let nextId = 1;

function entry(overrides: Partial<ExportEntry> = {}): ExportEntry {
  const id = nextId++;
  return {
    id,
    workArea: 'Vitrine',
    articleId: 1,
    isManual: false,
    description: 'Herrenring Gold',
    ean: '4000000000017',
    articleNumbers: ['R-1', 'R-2'],
    expectedQuantity: 1,
    category: 'Ringe',
    serialNumber: null,
    quantity: 1,
    priceNet: '100.00',
    priceGross: '119.00',
    workstation: 'Kasse',
    employees: ['Ben', 'Anna'],
    createdAt: new Date(`2026-09-25T08:00:0${id % 10}Z`),
    ...overrides,
  };
}

function manual(overrides: Partial<ExportEntry> = {}): ExportEntry {
  return entry({
    articleId: null,
    isManual: true,
    description: 'Brosche',
    ean: null,
    articleNumbers: [],
    expectedQuantity: null,
    category: null,
    priceNet: null,
    priceGross: '30.00',
    ...overrides,
  });
}

describe('entryTable', () => {
  it('has the columns of the specification', () => {
    expect(entryTable([]).columns.map((c) => c.header)).toEqual([
      'Arbeitsbereich',
      'Bezeichnung',
      'EAN',
      'Artikelnummer(n)',
      'Kategorie',
      'Seriennummer',
      'Menge',
      'Preis netto',
      'Preis brutto',
      'Summe netto',
      'Summe brutto',
      'manuell',
      'Station',
      'Mitarbeiter',
      'Zeitpunkt',
    ]);
  });

  it('writes one row per line with sums, by work area and time', () => {
    const late = entry({ quantity: 3, createdAt: new Date('2026-09-25T09:00:00Z') });
    const early = entry({ createdAt: new Date('2026-09-25T08:00:00Z'), serialNumber: 'S1' });
    const lager = manual({ workArea: 'Lager', quantity: 2, employees: ['Clara'] });
    const { rows } = entryTable([late, early, lager]);
    expect(rows).toEqual([
      [
        'Lager',
        'Brosche',
        null,
        '',
        null,
        null,
        2,
        null,
        '30.00',
        null,
        '60.00',
        'ja',
        'Kasse',
        'Clara',
        lager.createdAt,
      ],
      [
        'Vitrine',
        'Herrenring Gold',
        '4000000000017',
        'R-1, R-2',
        'Ringe',
        'S1',
        1,
        '100.00',
        '119.00',
        '100.00',
        '119.00',
        'nein',
        'Kasse',
        'Anna, Ben',
        early.createdAt,
      ],
      expect.arrayContaining(['Vitrine', 3, '300.00', '357.00']),
    ]);
  });
});

describe('articleTable', () => {
  it('sums the lines of an article across work areas and workstations', () => {
    const first = entry({ articleId: 7, workArea: 'Vitrine', serialNumber: 'A' });
    const second = entry({
      articleId: 7,
      workArea: 'Lager',
      workstation: 'Lager-PC',
      quantity: 2,
      employees: ['Clara'],
      serialNumber: 'B',
      // The master data changed in between: the sums keep each snapshot.
      priceNet: '110.00',
      priceGross: '130.90',
      createdAt: new Date('2026-09-25T10:00:00Z'),
    });
    const { rows, columns } = articleTable([first, second]);
    expect(columns.map((c) => c.header).slice(6, 10)).toEqual([
      'Zeilen',
      'Menge',
      'Soll',
      'Differenz',
    ]);
    expect(rows).toEqual([
      [
        'Lager, Vitrine',
        'Herrenring Gold',
        '4000000000017',
        'R-1, R-2',
        'Ringe',
        'A, B',
        2,
        3,
        1,
        2,
        '110.00',
        '130.90',
        '320.00',
        '380.80',
        'nein',
        'Kasse, Lager-PC',
        'Anna, Ben, Clara',
        second.createdAt,
      ],
    ]);
  });

  it('keeps every manual line as a row of its own, without net values', () => {
    const { rows } = articleTable([
      manual({ description: 'Brosche', quantity: 2 }),
      manual({ description: 'Brosche' }),
      entry({ articleId: 3, description: 'Armband' }),
    ]);
    expect(rows.map((row) => [row[1], row[7], row[8], row[9], row[12], row[13], row[14]])).toEqual([
      ['Armband', 1, 1, 0, '100.00', '119.00', 'nein'],
      ['Brosche', 2, null, null, null, '60.00', 'ja'],
      ['Brosche', 1, null, null, null, '30.00', 'ja'],
    ]);
  });

  it('shows the difference to the target quantity, or nothing without one', () => {
    const { rows } = articleTable([
      entry({ articleId: 1, description: 'Batterie', quantity: 4, expectedQuantity: 10 }),
      entry({ articleId: 2, description: 'Etui', quantity: 2, expectedQuantity: null }),
    ]);
    expect(rows.map((row) => [row[1], row[7], row[8], row[9]])).toEqual([
      ['Batterie', 4, 10, -6],
      ['Etui', 2, null, null],
    ]);
  });
});

describe('reconciliationTable', () => {
  const reconciliation: Reconciliation = {
    stocktakeId: 1,
    articleCount: 3,
    expectedQuantity: 13,
    withoutTargetCount: 0,
    shortage: {
      count: 2,
      quantity: 7,
      net: '206.00',
      gross: '245.14',
      byCategory: [],
      articles: [
        {
          articleId: 3,
          description: 'Damenuhr',
          ean: null,
          category: 'Uhren',
          priceNet: '200.00',
          priceGross: '238.00',
          expected: 1,
          counted: 0,
          missing: 1,
          net: '200.00',
          gross: '238.00',
        },
        {
          articleId: 4,
          description: 'Batterie',
          ean: null,
          category: 'Zubehör',
          priceNet: '1.00',
          priceGross: '1.19',
          expected: 10,
          counted: 4,
          missing: 6,
          net: '6.00',
          gross: '7.14',
        },
      ],
      truncated: false,
    },
    surplus: {
      quantity: 3,
      net: '100.00',
      gross: '179.00',
      items: [
        {
          kind: 'excess',
          articleId: 1,
          entryId: null,
          description: 'Herrenring',
          ean: '4000000000017',
          category: 'Ringe',
          priceNet: '100.00',
          priceGross: '119.00',
          expected: 1,
          counted: 2,
          surplus: 1,
          net: '100.00',
          gross: '119.00',
        },
        {
          kind: 'manual',
          articleId: null,
          entryId: 9,
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
        },
      ],
    },
  };

  it('lists the shortage with negative and the surplus with positive differences', () => {
    const { rows } = reconciliationTable(reconciliation, new Map([[3, ['U-3']]]));
    expect(rows).toEqual([
      [
        'Fehlbestand',
        'nicht erfasst',
        'Damenuhr',
        null,
        'U-3',
        'Uhren',
        1,
        0,
        -1,
        '200.00',
        '238.00',
        '-200.00',
        '-238.00',
      ],
      [
        'Fehlbestand',
        'zu wenig erfasst',
        'Batterie',
        null,
        '',
        'Zubehör',
        10,
        4,
        -6,
        '1.00',
        '1.19',
        '-6.00',
        '-7.14',
      ],
      [
        'Mehrbestand',
        'zu viel erfasst',
        'Herrenring',
        '4000000000017',
        '',
        'Ringe',
        1,
        2,
        1,
        '100.00',
        '119.00',
        '100.00',
        '119.00',
      ],
      [
        'Mehrbestand',
        'manuell erfasst',
        'Brosche',
        null,
        '',
        null,
        0,
        2,
        2,
        null,
        '30.00',
        null,
        '60.00',
      ],
    ]);
  });
});
