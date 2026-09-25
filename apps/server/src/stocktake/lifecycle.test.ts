import { describe, expect, it } from 'vitest';
import { DomainError } from '../errors.ts';
import {
  assertCanStart,
  assertWritable,
  parseStocktakeName,
  planFinish,
  planReopen,
  type StocktakeState,
  type WorkAreaState,
} from './lifecycle.ts';

const active: StocktakeState = { id: 1, status: 'active' };
const finished: StocktakeState = { id: 1, status: 'finished' };

function codeOf(action: () => unknown): string | undefined {
  try {
    action();
  } catch (error) {
    if (error instanceof DomainError) return error.code;
    throw error;
  }
  return undefined;
}

describe('parseStocktakeName', () => {
  it('normalizes the name', () => {
    expect(parseStocktakeName('  Inventur   2026 ')).toBe('Inventur 2026');
  });

  it('rejects empty names', () => {
    expect(codeOf(() => parseStocktakeName('  '))).toBe('validation_failed');
  });
});

describe('starting a stocktake', () => {
  it('is allowed without an active stocktake', () => {
    expect(codeOf(() => assertCanStart(undefined))).toBeUndefined();
  });

  it('is rejected while another stocktake is active', () => {
    expect(codeOf(() => assertCanStart(active))).toBe('stocktake_already_active');
  });
});

describe('writing to a stocktake', () => {
  it('is allowed while it is active', () => {
    expect(codeOf(() => assertWritable(active))).toBeUndefined();
  });

  it('is rejected once it is finished', () => {
    expect(codeOf(() => assertWritable(finished))).toBe('stocktake_finished');
  });

  it('is rejected for an unknown stocktake', () => {
    expect(codeOf(() => assertWritable(undefined))).toBe('not_found');
  });
});

describe('finishing a stocktake', () => {
  const areas: WorkAreaState[] = [
    { id: 1, name: 'Vitrine 1', status: 'closed' },
    { id: 2, name: 'Vitrine 2', status: 'in_progress' },
    { id: 3, name: 'Lager', status: 'open' },
  ];

  it('is allowed without confirmation when all work areas are closed', () => {
    expect(planFinish(active, [areas[0]!], false)).toEqual([]);
  });

  it('is allowed without work areas', () => {
    expect(planFinish(active, [], false)).toEqual([]);
  });

  it('lists the unclosed work areas and requires a confirmation', () => {
    let error: unknown;
    try {
      planFinish(active, areas, false);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe('unclosed_work_areas');
    expect((error as DomainError).details).toEqual({
      workAreas: [
        { id: 2, name: 'Vitrine 2', status: 'in_progress' },
        { id: 3, name: 'Lager', status: 'open' },
      ],
    });
  });

  it('is allowed with confirmation despite unclosed work areas', () => {
    expect(planFinish(active, areas, true).map((a) => a.id)).toEqual([2, 3]);
  });

  it('is rejected for a finished stocktake, even with confirmation', () => {
    expect(codeOf(() => planFinish(finished, [], true))).toBe('stocktake_finished');
  });

  it('is rejected for an unknown stocktake', () => {
    expect(codeOf(() => planFinish(undefined, [], true))).toBe('not_found');
  });
});

describe('reopening a stocktake', () => {
  const areas: WorkAreaState[] = [
    { id: 1, name: 'Vitrine 1', status: 'closed' },
    { id: 2, name: 'Vitrine 2', status: 'in_progress' },
    { id: 3, name: 'Lager', status: 'open' },
  ];

  it('turns a finished stocktake active again; areas in progress become open', () => {
    expect(planReopen(finished, undefined, areas).map((a) => a.id)).toEqual([2]);
  });

  it('is rejected while another stocktake is active', () => {
    const other = { id: 2, status: 'active' as const };
    expect(codeOf(() => planReopen(finished, other, areas))).toBe('stocktake_already_active');
  });

  it('is rejected for an active stocktake', () => {
    expect(codeOf(() => planReopen(active, active, areas))).toBe('stocktake_not_finished');
  });

  it('is rejected for an unknown stocktake', () => {
    expect(codeOf(() => planReopen(undefined, undefined, areas))).toBe('not_found');
  });
});
