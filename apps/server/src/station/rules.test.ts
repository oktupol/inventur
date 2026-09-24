import { describe, expect, it } from 'vitest';
import { DomainError } from '../errors.ts';
import { assertLoggedInHere, checkLogin, requireActiveStocktake } from './rules.ts';

function codeOf(action: () => unknown): string | undefined {
  try {
    action();
  } catch (error) {
    if (error instanceof DomainError) return error.code;
    throw error;
  }
  return undefined;
}

describe('requireActiveStocktake', () => {
  it('returns the active stocktake', () => {
    expect(requireActiveStocktake({ id: 1 })).toEqual({ id: 1 });
  });

  it('rejects when there is none', () => {
    expect(codeOf(() => requireActiveStocktake(null))).toBe('no_active_stocktake');
  });
});

describe('logging in an employee', () => {
  it('succeeds for a free employee', () => {
    expect(checkLogin(null, 1)).toBe(true);
  });

  it('changes nothing if the employee is already logged in here', () => {
    expect(checkLogin(1, 1)).toBe(false);
  });

  it('is rejected while the employee is logged in to another workstation', () => {
    expect(codeOf(() => checkLogin(2, 1))).toBe('employee_busy');
  });
});

describe('logging out an employee at a workstation', () => {
  it('succeeds for an employee logged in here', () => {
    expect(codeOf(() => assertLoggedInHere(1, 1))).toBeUndefined();
  });

  it('is rejected for employees of other workstations or free employees', () => {
    expect(codeOf(() => assertLoggedInHere(2, 1))).toBe('employee_not_logged_in');
    expect(codeOf(() => assertLoggedInHere(null, 1))).toBe('employee_not_logged_in');
  });
});
