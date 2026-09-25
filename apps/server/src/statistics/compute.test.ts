import { describe, expect, it } from 'vitest';
import {
  captureRate,
  computeStatistics,
  MAX_BUCKETS,
  type StatisticsEntry,
  type StatisticsInput,
} from './compute.ts';

let nextId = 1;

function entry(overrides: Partial<StatisticsEntry> = {}): StatisticsEntry {
  const id = nextId++;
  return {
    id,
    workAreaId: 1,
    articleId: 100 + id,
    isManual: false,
    input: '4000000000017',
    description: `Artikel ${id}`,
    ean: '4000000000017',
    category: 'Ringe',
    priceNet: '100.00',
    priceGross: '119.00',
    serialNumber: null,
    quantity: 1,
    workstationId: 1,
    createdAt: new Date('2026-01-02T09:00:00Z'),
    employeeIds: [1],
    ...overrides,
  };
}

function manual(overrides: Partial<StatisticsEntry> = {}): StatisticsEntry {
  return entry({
    articleId: null,
    isManual: true,
    input: '',
    ean: null,
    category: null,
    priceNet: null,
    priceGross: '50.00',
    ...overrides,
  });
}

function input(entries: StatisticsEntry[], overrides: Partial<StatisticsInput> = {}) {
  return {
    stocktakeId: 7,
    workAreas: [
      { id: 1, name: 'Vitrine 2', status: 'in_progress' as const },
      { id: 2, name: 'Lager', status: 'closed' as const },
      { id: 3, name: 'Vitrine 10', status: 'open' as const },
    ],
    employees: [
      { id: 1, name: 'Anna' },
      { id: 2, name: 'Ben' },
      { id: 3, name: 'Clara' },
    ],
    workstations: [
      { id: 1, name: 'Kasse' },
      { id: 2, name: 'Lager-PC' },
    ],
    entries,
    expectedQuantities: new Map<number, number>(),
    until: new Date('2026-01-02T10:00:00Z'),
    ...overrides,
  };
}

describe('computeStatistics', () => {
  it('counts the work areas by status', () => {
    expect(computeStatistics(input([])).progress).toEqual({
      open: 1,
      in_progress: 1,
      closed: 1,
      total: 3,
    });
  });

  it('sums lines, pieces and values; manual articles only count towards gross', () => {
    const stats = computeStatistics(
      input([
        entry({ quantity: 2 }),
        entry({ priceNet: '10.00', priceGross: '11.90' }),
        manual({ priceGross: '0.10', quantity: 3 }),
      ]),
    );
    expect(stats.totals).toEqual({ lines: 3, quantity: 6, net: '210.00', gross: '250.20' });
  });

  it('sums per work area, including areas without lines, ordered by name', () => {
    const stats = computeStatistics(
      input([entry({ workAreaId: 1 }), entry({ workAreaId: 2, quantity: 3 })]),
    );
    expect(stats.byWorkArea).toEqual([
      {
        id: 2,
        name: 'Lager',
        status: 'closed',
        lines: 1,
        quantity: 3,
        net: '300.00',
        gross: '357.00',
      },
      {
        id: 1,
        name: 'Vitrine 2',
        status: 'in_progress',
        lines: 1,
        quantity: 1,
        net: '100.00',
        gross: '119.00',
      },
      {
        id: 3,
        name: 'Vitrine 10',
        status: 'open',
        lines: 0,
        quantity: 0,
        net: '0.00',
        gross: '0.00',
      },
    ]);
  });

  it('groups by category; without category and manual articles come last', () => {
    const stats = computeStatistics(
      input([
        manual({ priceGross: '20.00' }),
        entry({ category: null, priceNet: '1.00', priceGross: '1.19' }),
        entry({ category: 'Uhren' }),
        entry({ category: 'Armbänder', quantity: 2 }),
        entry({ category: 'Uhren' }),
      ]),
    );
    expect(stats.byCategory).toEqual([
      {
        category: 'Armbänder',
        manual: false,
        lines: 1,
        quantity: 2,
        net: '200.00',
        gross: '238.00',
      },
      { category: 'Uhren', manual: false, lines: 2, quantity: 2, net: '200.00', gross: '238.00' },
      { category: null, manual: false, lines: 1, quantity: 1, net: '1.00', gross: '1.19' },
      { category: null, manual: true, lines: 1, quantity: 1, net: null, gross: '20.00' },
    ]);
  });

  it('counts lines per employee, for each employee of a line, and lists employees without lines', () => {
    const stats = computeStatistics(
      input([
        entry({ employeeIds: [1, 2], quantity: 2 }),
        entry({ employeeIds: [2] }),
        entry({ employeeIds: [2, 2] }),
      ]),
    );
    expect(stats.byEmployee).toEqual([
      { id: 2, name: 'Ben', lines: 3, quantity: 4 },
      { id: 1, name: 'Anna', lines: 1, quantity: 2 },
      { id: 3, name: 'Clara', lines: 0, quantity: 0 },
    ]);
  });

  it('counts lines per workstation', () => {
    const stats = computeStatistics(
      input([
        entry({ workstationId: 2 }),
        entry({ workstationId: 1 }),
        entry({ workstationId: 2 }),
      ]),
    );
    expect(stats.byWorkstation).toEqual([
      { id: 2, name: 'Lager-PC', lines: 2, quantity: 2 },
      { id: 1, name: 'Kasse', lines: 1, quantity: 1 },
    ]);
  });

  it('lists manual lines with their values by time', () => {
    const late = manual({
      description: 'Brosche',
      input: '999',
      quantity: 2,
      serialNumber: 'S1',
      createdAt: new Date('2026-01-02T09:30:00Z'),
    });
    const early = manual({ description: 'Anhänger', workAreaId: 2, workstationId: 2 });
    const stats = computeStatistics(input([entry(), late, early]));
    expect(stats.manual).toEqual({
      lines: 2,
      quantity: 3,
      gross: '150.00',
      entries: [
        {
          id: early.id,
          workArea: { id: 2, name: 'Lager' },
          description: 'Anhänger',
          input: '',
          serialNumber: null,
          quantity: 1,
          priceGross: '50.00',
          gross: '50.00',
          workstation: { id: 2, name: 'Lager-PC' },
          createdAt: '2026-01-02T09:00:00.000Z',
        },
        {
          id: late.id,
          workArea: { id: 1, name: 'Vitrine 2' },
          description: 'Brosche',
          input: '999',
          serialNumber: 'S1',
          quantity: 2,
          priceGross: '50.00',
          gross: '100.00',
          workstation: { id: 1, name: 'Kasse' },
          createdAt: '2026-01-02T09:30:00.000Z',
        },
      ],
    });
  });

  it('reports articles captured more often than their target quantity', () => {
    const stats = computeStatistics(
      input(
        [
          entry({ articleId: 1, description: 'Ring', workAreaId: 1 }),
          entry({ articleId: 1, description: 'Ring', workAreaId: 2 }),
          entry({ articleId: 2, description: 'Uhr', quantity: 3 }),
          // Within the target of 10.
          entry({ articleId: 3, description: 'Batterie', quantity: 4 }),
          entry({ articleId: 3, description: 'Batterie', quantity: 6 }),
          // Target 0: every piece is too many.
          entry({ articleId: 4, description: 'Kette' }),
          // Without a target quantity: not compared.
          entry({ articleId: 5, description: 'Armband', quantity: 7 }),
          manual({ quantity: 5 }),
        ],
        {
          expectedQuantities: new Map([
            [1, 1],
            [2, 1],
            [3, 10],
            [4, 0],
          ]),
        },
      ),
    );
    expect(stats.overcounted).toEqual([
      {
        articleId: 2,
        description: 'Uhr',
        ean: '4000000000017',
        expected: 1,
        lines: 1,
        quantity: 3,
        workAreas: [{ id: 1, name: 'Vitrine 2' }],
      },
      {
        articleId: 4,
        description: 'Kette',
        ean: '4000000000017',
        expected: 0,
        lines: 1,
        quantity: 1,
        workAreas: [{ id: 1, name: 'Vitrine 2' }],
      },
      {
        articleId: 1,
        description: 'Ring',
        ean: '4000000000017',
        expected: 1,
        lines: 2,
        quantity: 2,
        workAreas: [
          { id: 2, name: 'Lager' },
          { id: 1, name: 'Vitrine 2' },
        ],
      },
    ]);
  });

  it('returns empty figures without lines', () => {
    const stats = computeStatistics(input([]));
    expect(stats.totals).toEqual({ lines: 0, quantity: 0, net: '0.00', gross: '0.00' });
    expect(stats.byCategory).toEqual([]);
    expect(stats.byWorkstation).toEqual([]);
    expect(stats.overcounted).toEqual([]);
    expect(stats.manual).toEqual({ lines: 0, quantity: 0, gross: '0.00', entries: [] });
    expect(stats.rate.buckets).toEqual([]);
  });
});

describe('captureRate', () => {
  const at = (time: string, quantity = 1) => ({ createdAt: new Date(time), quantity });

  it('counts lines and pieces per interval, including empty intervals until the end', () => {
    const rate = captureRate(
      [at('2026-01-02T09:01:00Z'), at('2026-01-02T09:04:59Z', 2), at('2026-01-02T09:12:00Z')],
      new Date('2026-01-02T09:16:00Z'),
    );
    expect(rate).toEqual({
      bucketMinutes: 5,
      buckets: [
        { start: '2026-01-02T09:00:00.000Z', lines: 2, quantity: 3 },
        { start: '2026-01-02T09:05:00.000Z', lines: 0, quantity: 0 },
        { start: '2026-01-02T09:10:00.000Z', lines: 1, quantity: 1 },
        { start: '2026-01-02T09:15:00.000Z', lines: 0, quantity: 0 },
      ],
    });
  });

  it('chooses longer intervals for longer stocktakes', () => {
    const rate = captureRate(
      [at('2026-01-02T08:00:00Z'), at('2026-01-02T17:59:00Z')],
      new Date('2026-01-02T18:00:00Z'),
    );
    expect(rate.bucketMinutes).toBe(15);
    expect(rate.buckets).toHaveLength(41);
    expect(rate.buckets.at(-1)).toEqual({
      start: '2026-01-02T18:00:00.000Z',
      lines: 0,
      quantity: 0,
    });
  });

  it('never exceeds the maximum number of intervals', () => {
    for (const hours of [1, 4, 5, 13, 30, 60, 200, 1000]) {
      const rate = captureRate(
        [at('2026-01-02T08:03:00Z')],
        new Date(Date.parse('2026-01-02T08:03:00Z') + hours * 3_600_000),
      );
      expect(rate.buckets.length).toBeLessThanOrEqual(MAX_BUCKETS);
      expect(rate.buckets[0]!.lines).toBe(1);
    }
  });

  it('includes lines created after the end', () => {
    const rate = captureRate([at('2026-01-02T09:07:00Z')], new Date('2026-01-02T09:00:00Z'));
    expect(rate.buckets).toEqual([{ start: '2026-01-02T09:05:00.000Z', lines: 1, quantity: 1 }]);
  });
});
