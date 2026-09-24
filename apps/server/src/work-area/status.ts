import type { WorkAreaStatus } from '@inventur/shared';
import { DomainError } from '../errors.ts';

/**
 * State machine of a work area:
 *
 *   open ──(workstation joins)──▶ in_progress ──(last workstation leaves)──▶ open
 *     │                              │
 *     └──────────(close)─────────────┴──▶ closed ──(reopen)──▶ open
 */
export type WorkAreaTransition =
  | { type: 'join' }
  | { type: 'leave'; remainingWorkstations: number }
  | { type: 'close' }
  | { type: 'reopen' };

export function nextStatus(status: WorkAreaStatus, transition: WorkAreaTransition): WorkAreaStatus {
  switch (transition.type) {
    case 'join':
      if (status === 'closed') {
        throw new DomainError('work_area_closed', 'Work area is closed; reopen it first');
      }
      return 'in_progress';
    case 'leave':
      return status === 'in_progress' && transition.remainingWorkstations === 0 ? 'open' : status;
    case 'close':
      return 'closed';
    case 'reopen':
      return status === 'closed' ? 'open' : status;
  }
}

/** Entries can only be added to work areas that are not closed. */
export function acceptsEntries(status: WorkAreaStatus): boolean {
  return status !== 'closed';
}
