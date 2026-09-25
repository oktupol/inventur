import { describe, expect, it } from 'vitest';
import {
  buildWorkAreaCountList,
  sumCountLists,
  type CountListLine,
  type WorkAreaInput,
} from './model.ts';

const START = Date.parse('2026-09-25T07:00:00Z');

/** A line created `minute` minutes after the start. */
function line(id: number, minute: number, overrides: Partial<CountListLine> = {}): CountListLine {
  const ms = START + minute * 60_000;
  return {
    id,
    at: ms * 1000,
    createdAt: new Date(ms),
    description: `Artikel ${id}`,
    ean: '4000000000017',
    input: '4000000000017',
    serialNumber: null,
    quantity: 1,
    priceNet: '100.00',
    priceGross: '119.00',
    isManual: false,
    workstation: 'Kasse',
    ...overrides,
  };
}

function checkpoint(id: number, minute: number, workstation: string | null = 'Kasse') {
  const ms = START + minute * 60_000;
  return { id, at: ms * 1000, createdAt: new Date(ms), workstation };
}

function input(overrides: Partial<WorkAreaInput>): WorkAreaInput {
  return {
    name: 'Vitrine 3',
    description: null,
    status: 'closed',
    employees: [],
    lines: [],
    checkpoints: [],
    ...overrides,
  };
}

describe('buildWorkAreaCountList', () => {
  it('numbers the lines in the order they were captured', () => {
    const list = buildWorkAreaCountList(input({ lines: [line(3, 2), line(1, 0), line(2, 1)] }));
    expect(list.sections).toHaveLength(1);
    expect(list.sections[0]!.checkpoint).toBeNull();
    expect(list.sections[0]!.positions.map((p) => [p.position, p.id])).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
    expect(list.period).toEqual({ from: new Date(START), to: new Date(START + 120_000) });
  });

  it('closes each section with the subtotals of its checkpoint', () => {
    const list = buildWorkAreaCountList(
      input({
        lines: [
          line(1, 0, { quantity: 2 }),
          line(2, 1),
          // Created exactly at the boundary: it belongs before the checkpoint.
          line(3, 2, { isManual: true, priceNet: null, priceGross: '10.00' }),
          line(4, 3, { priceNet: '1.00', priceGross: '1.19' }),
          line(5, 5),
        ],
        checkpoints: [checkpoint(20, 4, null), checkpoint(10, 2)],
      }),
    );
    expect(list.sections.map((s) => s.positions.map((p) => p.id))).toEqual([[1, 2, 3], [4], [5]]);
    expect(list.sections.map((s) => s.checkpoint)).toEqual([
      {
        number: 1,
        createdAt: new Date(START + 120_000),
        workstation: 'Kasse',
        section: { lines: 3, quantity: 4, net: '300.00', gross: '367.00' },
        sinceStart: { lines: 3, quantity: 4, net: '300.00', gross: '367.00' },
      },
      {
        number: 2,
        createdAt: new Date(START + 240_000),
        workstation: null,
        section: { lines: 1, quantity: 1, net: '1.00', gross: '1.19' },
        sinceStart: { lines: 4, quantity: 5, net: '301.00', gross: '368.19' },
      },
      null,
    ]);
    expect(list.totals).toEqual({ lines: 5, quantity: 6, net: '401.00', gross: '487.19' });
  });

  it('leaves out the last section when no line follows the newest checkpoint', () => {
    const list = buildWorkAreaCountList(
      input({ lines: [line(1, 0), line(2, 1)], checkpoints: [checkpoint(1, 1)] }),
    );
    expect(list.sections).toHaveLength(1);
    expect(list.sections[0]!.checkpoint?.number).toBe(1);
  });

  it('returns an empty list for a work area without lines', () => {
    const list = buildWorkAreaCountList(input({ description: 'links', status: 'open' }));
    expect(list).toEqual({
      name: 'Vitrine 3',
      description: 'links',
      status: 'open',
      employees: [],
      period: null,
      sections: [],
      totals: { lines: 0, quantity: 0, net: '0.00', gross: '0.00' },
    });
  });

  it('lists every employee once, by name', () => {
    const list = buildWorkAreaCountList(input({ employees: ['Jörg', 'Anna', 'Jörg', 'Ömer'] }));
    expect(list.employees).toEqual(['Anna', 'Jörg', 'Ömer']);
  });
});

describe('sumCountLists', () => {
  it('adds up the totals of several work areas', () => {
    const a = buildWorkAreaCountList(input({ lines: [line(1, 0, { quantity: 2 })] }));
    const b = buildWorkAreaCountList(
      input({ lines: [line(2, 0, { isManual: true, priceNet: null, priceGross: '0.10' })] }),
    );
    expect(sumCountLists([a, b])).toEqual({
      lines: 2,
      quantity: 3,
      net: '200.00',
      gross: '238.10',
    });
    expect(sumCountLists([])).toEqual({ lines: 0, quantity: 0, net: '0.00', gross: '0.00' });
  });
});
