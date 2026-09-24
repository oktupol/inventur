import type { WorkAreaStatus } from '@inventur/shared';
import { describe, expect, it } from 'vitest';
import { DomainError } from '../errors.ts';
import { acceptsEntries, nextStatus, type WorkAreaTransition } from './status.ts';

function codeOf(action: () => unknown): string | undefined {
  try {
    action();
  } catch (error) {
    if (error instanceof DomainError) return error.code;
    throw error;
  }
  return undefined;
}

describe('work area state machine', () => {
  const cases: [WorkAreaStatus, WorkAreaTransition, WorkAreaStatus][] = [
    // A workstation joins.
    ['open', { type: 'join' }, 'in_progress'],
    ['in_progress', { type: 'join' }, 'in_progress'],
    // A workstation leaves.
    ['in_progress', { type: 'leave', remainingWorkstations: 0 }, 'open'],
    ['in_progress', { type: 'leave', remainingWorkstations: 2 }, 'in_progress'],
    ['open', { type: 'leave', remainingWorkstations: 0 }, 'open'],
    ['closed', { type: 'leave', remainingWorkstations: 0 }, 'closed'],
    // Closing works from every status.
    ['open', { type: 'close' }, 'closed'],
    ['in_progress', { type: 'close' }, 'closed'],
    ['closed', { type: 'close' }, 'closed'],
    // Reopening leads back to open.
    ['closed', { type: 'reopen' }, 'open'],
    ['open', { type: 'reopen' }, 'open'],
    ['in_progress', { type: 'reopen' }, 'in_progress'],
  ];

  it.each(cases)('%s --%o--> %s', (from, transition, to) => {
    expect(nextStatus(from, transition)).toBe(to);
  });

  it('rejects joining a closed work area', () => {
    expect(codeOf(() => nextStatus('closed', { type: 'join' }))).toBe('work_area_closed');
  });

  it('becomes in progress again when a workstation joins after reopening', () => {
    const reopened = nextStatus('closed', { type: 'reopen' });
    expect(nextStatus(reopened, { type: 'join' })).toBe('in_progress');
  });

  it('accepts entries unless closed', () => {
    expect(acceptsEntries('open')).toBe(true);
    expect(acceptsEntries('in_progress')).toBe(true);
    expect(acceptsEntries('closed')).toBe(false);
  });
});
