import { describe, expect, it } from 'vitest';
import { entryChange, entryCode, stocktakeChange, toAuditLogEntry, toPage } from './rules.ts';

const entry = {
  id: 7,
  work_area_id: 3,
  description: 'Herrenuhr',
  ean: '4000000000017',
  input: '4000000000017',
};

describe('entryCode', () => {
  it('prefers the EAN', () => {
    expect(entryCode({ ean: '4000000000017', input: 'AB-1' })).toBe('4000000000017');
  });

  it('falls back to the input and to null without one', () => {
    expect(entryCode({ ean: null, input: ' AB-1 ' })).toBe('AB-1');
    expect(entryCode({ ean: null, input: '  ' })).toBeNull();
  });
});

describe('entryChange', () => {
  it('records old and new values as text', () => {
    expect(entryChange('quantity_changed', entry, 1, 3)).toEqual({
      action: 'quantity_changed',
      entry_id: 7,
      work_area_id: 3,
      description: 'Herrenuhr',
      code: '4000000000017',
      old_value: '1',
      new_value: '3',
    });
  });

  it('keeps missing values empty', () => {
    const change = entryChange('deleted', entry, 2, null);
    expect(change.old_value).toBe('2');
    expect(change.new_value).toBeNull();
  });
});

describe('stocktakeChange', () => {
  it('refers to no line', () => {
    expect(stocktakeChange('stocktake_finished')).toMatchObject({
      action: 'stocktake_finished',
      entry_id: null,
      work_area_id: null,
    });
  });
});

describe('toAuditLogEntry', () => {
  const row = {
    id: 1,
    action: 'deleted' as const,
    entry_id: 7,
    work_area_id: 3,
    work_area_name: 'Vitrine 1',
    description: 'Herrenuhr',
    code: '4000000000017',
    old_value: '1',
    new_value: null,
    source: 'phone' as const,
    workstation_id: 2,
    workstation_name: 'Kasse',
    employee_names: ['Anna'],
    created_at: new Date('2026-09-25T10:00:00Z'),
  };

  it('maps a row with work area and workstation', () => {
    expect(toAuditLogEntry(row)).toEqual({
      id: 1,
      action: 'deleted',
      entryId: 7,
      workArea: { id: 3, name: 'Vitrine 1' },
      description: 'Herrenuhr',
      code: '4000000000017',
      oldValue: '1',
      newValue: null,
      source: 'phone',
      workstation: { id: 2, name: 'Kasse' },
      employees: ['Anna'],
      createdAt: '2026-09-25T10:00:00.000Z',
    });
  });

  it('maps changes in the dashboard without work area and workstation', () => {
    const mapped = toAuditLogEntry({
      ...row,
      work_area_id: null,
      work_area_name: null,
      workstation_id: null,
      workstation_name: null,
      source: 'admin',
    });
    expect(mapped.workArea).toBeNull();
    expect(mapped.workstation).toBeNull();
  });
});

describe('toPage', () => {
  it('reports more rows when the extra row was loaded', () => {
    expect(toPage([1, 2, 3], 2)).toEqual({ items: [1, 2], hasMore: true });
    expect(toPage([1, 2], 2)).toEqual({ items: [1, 2], hasMore: false });
  });
});
