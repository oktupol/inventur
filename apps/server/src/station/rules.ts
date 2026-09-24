import { DomainError } from '../errors.ts';

/**
 * Rules for workstations and the employees logged in to them, independent of
 * the database.
 */

export function requireActiveStocktake<T>(stocktake: T | null | undefined): T {
  if (!stocktake) throw new DomainError('no_active_stocktake', 'There is no active stocktake');
  return stocktake;
}

/**
 * An employee can only log in to a workstation while they are not logged in
 * elsewhere; they have to log out there first. Returns false if they are
 * already logged in to this workstation, so nothing changes.
 */
export function checkLogin(currentWorkstationId: number | null, workstationId: number): boolean {
  if (currentWorkstationId === workstationId) return false;
  if (currentWorkstationId !== null) {
    throw new DomainError('employee_busy', 'Employee is logged in to another workstation');
  }
  return true;
}

/** A workstation can only log out its own employees; the admin can log out anyone. */
export function assertLoggedInHere(currentWorkstationId: number | null, workstationId: number) {
  if (currentWorkstationId !== workstationId) {
    throw new DomainError(
      'employee_not_logged_in',
      'Employee is not logged in to this workstation',
    );
  }
}
