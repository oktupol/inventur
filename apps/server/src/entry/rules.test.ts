import type { Article } from '@inventur/shared';
import { describe, expect, it } from 'vitest';
import { DomainError } from '../errors.ts';
import { assertCanCapture, parseInput, snapshotOf } from './rules.ts';

function codeOf(action: () => unknown): string | undefined {
  try {
    action();
  } catch (error) {
    if (error instanceof DomainError) return error.code;
    throw error;
  }
  return undefined;
}

describe('assertCanCapture', () => {
  it('allows capturing in an open or in-progress area with an employee', () => {
    for (const status of ['open', 'in_progress'] as const) {
      expect(codeOf(() => assertCanCapture({ workArea: { status }, employeeCount: 1 }))).toBe(
        undefined,
      );
    }
  });

  it('requires a work area', () => {
    expect(codeOf(() => assertCanCapture({ workArea: null, employeeCount: 1 }))).toBe(
      'no_work_area',
    );
  });

  it('rejects closed work areas', () => {
    expect(
      codeOf(() => assertCanCapture({ workArea: { status: 'closed' }, employeeCount: 1 })),
    ).toBe('work_area_closed');
  });

  it('requires a logged-in employee', () => {
    expect(
      codeOf(() => assertCanCapture({ workArea: { status: 'in_progress' }, employeeCount: 0 })),
    ).toBe('no_employee_logged_in');
  });
});

describe('parseInput', () => {
  it('trims the input', () => {
    expect(parseInput(' 4006381333931\n')).toBe('4006381333931');
  });

  it('rejects empty input', () => {
    expect(codeOf(() => parseInput('  '))).toBe('validation_failed');
  });
});

describe('snapshotOf', () => {
  it('copies the master data of the article', () => {
    const article: Article = {
      id: 5,
      description: 'Ring',
      ean: '4006381333931',
      articleNumbers: ['A-1'],
      category: 'Ringe',
      priceNet: '100.00',
      priceGross: '119.00',
    };
    expect(snapshotOf(article)).toEqual({
      article_id: 5,
      is_manual: false,
      description: 'Ring',
      ean: '4006381333931',
      category: 'Ringe',
      price_net: '100.00',
      price_gross: '119.00',
    });
  });
});
