import type { Article } from '@inventur/shared';
import { describe, expect, it } from 'vitest';
import { DomainError } from '../errors.ts';
import {
  assertCanCapture,
  manualEntryValues,
  nextQuantity,
  parseInput,
  snapshotOf,
} from './rules.ts';

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

describe('nextQuantity', () => {
  it('sets an absolute quantity', () => {
    expect(nextQuantity(1, { quantity: 20 })).toBe(20);
  });

  it('rejects quantities below 1, fractions and too large values', () => {
    for (const quantity of [0, -3, 1.5, 100_000]) {
      expect(codeOf(() => nextQuantity(1, { quantity }))).toBe('validation_failed');
    }
  });

  it('increments and decrements', () => {
    expect(nextQuantity(1, { delta: 1 })).toBe(2);
    expect(nextQuantity(3, { delta: -1 })).toBe(2);
  });

  it('does not decrement below 1', () => {
    expect(nextQuantity(1, { delta: -1 })).toBe(1);
  });

  it('does not increment above the maximum', () => {
    expect(nextQuantity(99_999, { delta: 1 })).toBe(99_999);
  });
});

describe('manualEntryValues', () => {
  it('stores a manual line without net price and category', () => {
    expect(
      manualEntryValues({
        input: ' 4099999999994 ',
        description: '  Ring   Silber ',
        priceGross: '49,90',
        serialNumber: ' SN-1 ',
      }),
    ).toEqual({
      article_id: null,
      is_manual: true,
      input: '4099999999994',
      description: 'Ring Silber',
      ean: null,
      category: null,
      price_net: null,
      price_gross: '49.90',
      serial_number: 'SN-1',
    });
  });

  it('allows an empty input and serial number', () => {
    const values = manualEntryValues({ input: '', description: 'Ring', priceGross: '10' });
    expect(values).toMatchObject({ input: '', serial_number: null, price_gross: '10.00' });
  });

  it('requires a description and a positive gross price', () => {
    expect(codeOf(() => manualEntryValues({ input: '', description: ' ', priceGross: '1' }))).toBe(
      'validation_failed',
    );
    for (const priceGross of ['0', '', '-3', 'x']) {
      expect(codeOf(() => manualEntryValues({ input: '', description: 'Ring', priceGross }))).toBe(
        'validation_failed',
      );
    }
  });
});
