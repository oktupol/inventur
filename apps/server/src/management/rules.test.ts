import { describe, expect, it } from 'vitest';
import { DomainError } from '../errors.ts';
import {
  assertDeletable,
  assertNameAvailable,
  parseDescription,
  parseName,
  selectForImport,
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

describe('parseName', () => {
  it('normalizes names', () => {
    expect(parseName(' Anna  Berger ', 'Employee')).toBe('Anna Berger');
  });

  it('rejects empty and overlong names', () => {
    expect(codeOf(() => parseName('', 'Work area'))).toBe('validation_failed');
    expect(codeOf(() => parseName('x'.repeat(101), 'Workstation'))).toBe('validation_failed');
  });
});

describe('parseDescription', () => {
  it('trims descriptions and stores empty ones as null', () => {
    expect(parseDescription('  Linke Wand ')).toBe('Linke Wand');
    expect(parseDescription('   ')).toBeNull();
    expect(parseDescription(null)).toBeNull();
    expect(parseDescription(undefined)).toBeNull();
  });

  it('rejects overlong descriptions', () => {
    expect(codeOf(() => parseDescription('x'.repeat(501)))).toBe('validation_failed');
  });
});

describe('assertNameAvailable', () => {
  const existing = [
    { id: 1, name: 'Anna' },
    { id: 2, name: 'Ömer' },
  ];

  it('accepts a new name', () => {
    expect(codeOf(() => assertNameAvailable('Ben', existing, 'Employee'))).toBeUndefined();
  });

  it('rejects an existing name regardless of case', () => {
    expect(codeOf(() => assertNameAvailable('Anna', existing, 'Employee'))).toBe('name_taken');
    expect(codeOf(() => assertNameAvailable('ömer', existing, 'Employee'))).toBe('name_taken');
  });

  it('allows keeping or changing the case of the own name when renaming', () => {
    expect(codeOf(() => assertNameAvailable('ANNA', existing, 'Workstation', 1))).toBeUndefined();
    expect(codeOf(() => assertNameAvailable('Anna', existing, 'Workstation', 2))).toBe(
      'name_taken',
    );
  });
});

describe('assertDeletable', () => {
  it('allows deleting without entries', () => {
    expect(codeOf(() => assertDeletable(0, 'Employee'))).toBeUndefined();
  });

  it.each([
    ['Employee', 'employee_has_entries'],
    ['Work area', 'work_area_has_entries'],
    ['Workstation', 'workstation_has_entries'],
  ] as const)('rejects deleting a %s with entries', (subject, code) => {
    expect(codeOf(() => assertDeletable(3, subject))).toBe(code);
  });
});

describe('selectForImport', () => {
  it('skips names that already exist, ignoring case, and keeps the order', () => {
    const previous = [{ name: 'Vitrine 1' }, { name: 'Lager' }, { name: 'Vitrine 2' }];
    expect(selectForImport(previous, [{ name: 'lager' }])).toEqual([
      { name: 'Vitrine 1' },
      { name: 'Vitrine 2' },
    ]);
  });

  it('skips duplicates within the previous stocktake', () => {
    expect(selectForImport([{ name: 'Anna' }, { name: 'ANNA' }], [])).toEqual([{ name: 'Anna' }]);
  });

  it('imports nothing when everything exists', () => {
    expect(selectForImport([{ name: 'Anna' }], [{ name: 'Anna' }])).toEqual([]);
  });
});
