import { describe, expect, it } from 'vitest';
import { statusAfterLeave } from './status.ts';

describe('statusAfterLeave', () => {
  it('falls back to open when the last workstation leaves', () => {
    expect(statusAfterLeave('in_progress', 0)).toBe('open');
  });

  it('stays in progress while other workstations remain', () => {
    expect(statusAfterLeave('in_progress', 1)).toBe('in_progress');
  });

  it('keeps open and closed areas unchanged', () => {
    expect(statusAfterLeave('open', 0)).toBe('open');
    expect(statusAfterLeave('closed', 0)).toBe('closed');
  });
});
