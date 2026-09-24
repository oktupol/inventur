import { describe, expect, it } from 'vitest';
import { MAX_NAME_LENGTH, normalizeName } from './names.ts';

describe('normalizeName', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizeName('  Vitrine   3 ')).toBe('Vitrine 3');
    expect(normalizeName('Lager\tUhren')).toBe('Lager Uhren');
  });

  it('rejects empty names', () => {
    expect(normalizeName('')).toBeNull();
    expect(normalizeName('   ')).toBeNull();
  });

  it('accepts names up to the maximum length', () => {
    expect(normalizeName('a'.repeat(MAX_NAME_LENGTH))).toHaveLength(MAX_NAME_LENGTH);
    expect(normalizeName('a'.repeat(MAX_NAME_LENGTH + 1))).toBeNull();
  });
});
