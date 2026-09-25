import type { AuditLogEntry } from '@inventur/shared';
import { describe, expect, it } from 'vitest';
import { describeChange, mergeAuditPages } from './audit-log.ts';

function entry(id: number, overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    id,
    action: 'quantity_changed',
    entryId: 1,
    workArea: { id: 1, name: 'Vitrine' },
    description: 'Ring',
    code: '4000000000017',
    oldValue: '1',
    newValue: '2',
    source: 'station',
    workstation: { id: 1, name: 'Kasse' },
    employees: ['Anna'],
    createdAt: '2026-09-25T08:00:00.000Z',
    ...overrides,
  };
}

describe('mergeAuditPages', () => {
  it('appends older pages newest first', () => {
    const ids = mergeAuditPages([entry(5), entry(4)], [entry(3), entry(2)]).map((e) => e.id);
    expect(ids).toEqual([5, 4, 3, 2]);
  });

  it('keeps entries that left the first page after new ones arrived', () => {
    const ids = mergeAuditPages([entry(7), entry(6), entry(5)], [entry(3)]).map((e) => e.id);
    expect(ids).toEqual([7, 6, 5, 3]);
    const shifted = mergeAuditPages([entry(9), entry(8), entry(7)], [entry(6), entry(5), entry(3)]);
    expect(shifted.map((e) => e.id)).toEqual([9, 8, 7, 6, 5, 3]);
  });
});

describe('describeChange', () => {
  it('shows quantities and serial numbers before and after', () => {
    expect(describeChange(entry(1))).toBe('1 → 2');
    expect(
      describeChange(entry(1, { action: 'serial_number_changed', oldValue: null, newValue: 'S1' })),
    ).toBe('(keine) → S1');
  });

  it('shows the quantity of a deleted or restored line', () => {
    expect(describeChange(entry(1, { action: 'deleted', oldValue: '3', newValue: null }))).toBe(
      'Menge 3',
    );
    expect(describeChange(entry(1, { action: 'restored', oldValue: null, newValue: '3' }))).toBe(
      'Menge 3',
    );
  });

  it('is empty for changes of the stocktake', () => {
    expect(describeChange(entry(1, { action: 'stocktake_reopened' }))).toBe('');
  });
});
