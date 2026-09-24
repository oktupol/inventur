import { describe, expect, it } from 'vitest';
import { isChannel, workAreaChannel, workstationChannel } from './channels.ts';

describe('channels', () => {
  it('builds id channels', () => {
    expect(workstationChannel(3)).toBe('workstation:3');
    expect(workAreaChannel(12)).toBe('work_area:12');
  });

  it.each(['admin', 'workstations', 'workstation:1', 'work_area:42'])('accepts %s', (value) => {
    expect(isChannel(value)).toBe(true);
  });

  it.each([
    '',
    'Admin',
    'workstation',
    'workstation:',
    'workstation:0',
    'work_area:-1',
    'work_area:1a',
    'employee:1',
    5,
    null,
  ])('rejects %j', (value) => {
    expect(isChannel(value)).toBe(false);
  });
});
