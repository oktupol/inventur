import {
  normalizeName,
  type StocktakeStatus,
  type UnclosedWorkAreasDetails,
  type WorkAreaStatus,
} from '@inventur/shared';
import { DomainError } from '../errors.ts';

/**
 * Rules of the stocktake lifecycle, independent of the database:
 * start (at most one active) → active → finish → finished (read-only),
 * and back to active by reopening while no other stocktake is active.
 */

export interface StocktakeState {
  id: number;
  status: StocktakeStatus;
}

export interface WorkAreaState {
  id: number;
  name: string;
  status: WorkAreaStatus;
}

export function parseStocktakeName(name: string): string {
  const normalized = normalizeName(name);
  if (normalized === null) {
    throw new DomainError('validation_failed', 'Stocktake name must not be empty or too long');
  }
  return normalized;
}

/** A new stocktake can only be started while no other one is active. */
export function assertCanStart(active: StocktakeState | undefined): void {
  if (active) {
    throw new DomainError(
      'stocktake_already_active',
      `Stocktake ${active.id} is still active and must be finished first`,
    );
  }
}

/**
 * Every write to a stocktake or its data (employees, work areas, entries, …)
 * requires the stocktake to exist and to be active.
 */
export function assertWritable(
  stocktake: StocktakeState | undefined,
): asserts stocktake is StocktakeState & { status: 'active' } {
  if (!stocktake) {
    throw new DomainError('not_found', 'Stocktake not found');
  }
  if (stocktake.status === 'finished') {
    throw new DomainError(
      'stocktake_finished',
      `Stocktake ${stocktake.id} is finished and read-only`,
    );
  }
}

/**
 * Checks whether the stocktake may be finished. While work areas are not
 * closed, finishing needs an explicit confirmation; the error lists them.
 * Returns the work areas that stay unclosed.
 */
export function planFinish(
  stocktake: StocktakeState | undefined,
  workAreas: readonly WorkAreaState[],
  confirmed: boolean,
): WorkAreaState[] {
  assertWritable(stocktake);
  const unclosed = workAreas.filter((area) => area.status !== 'closed');
  if (unclosed.length > 0 && !confirmed) {
    const details: UnclosedWorkAreasDetails = {
      workAreas: unclosed.map(({ id, name, status }) => ({
        id,
        name,
        status: status as Exclude<WorkAreaStatus, 'closed'>,
      })),
    };
    throw new DomainError(
      'unclosed_work_areas',
      `${unclosed.length} work area(s) are not closed; confirm to finish anyway`,
      details,
    );
  }
  return unclosed;
}

/**
 * Checks whether a finished stocktake may be reopened: only while no other
 * stocktake is active. Returns the work areas that fall back to "open";
 * workstations left all work areas when the stocktake was finished, so
 * "in progress" no longer applies.
 */
export function planReopen(
  stocktake: StocktakeState | undefined,
  active: StocktakeState | undefined,
  workAreas: readonly WorkAreaState[],
): WorkAreaState[] {
  if (!stocktake) throw new DomainError('not_found', 'Stocktake not found');
  if (stocktake.status !== 'finished') {
    throw new DomainError('stocktake_not_finished', `Stocktake ${stocktake.id} is not finished`);
  }
  assertCanStart(active);
  return workAreas.filter((area) => area.status === 'in_progress');
}
