import type { WorkAreaStatus } from '@inventur/shared';

/**
 * Status of a work area after a workstation left it. When the last workstation
 * leaves an area in progress, it falls back to open; closed stays closed.
 */
export function statusAfterLeave(
  status: WorkAreaStatus,
  remainingWorkstations: number,
): WorkAreaStatus {
  return status === 'in_progress' && remainingWorkstations === 0 ? 'open' : status;
}
