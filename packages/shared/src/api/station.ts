import type { NamedRef } from './common.ts';
import type { WorkAreaStatus } from './work-area.ts';

/** Header with which a workstation authenticates its requests to `/api/station/*`. */
export const WORKSTATION_TOKEN_HEADER = 'x-workstation-token';

/** `POST /api/station/register` */
export interface RegisterWorkstationRequest {
  name: string;
}

/** `POST /api/station/take-over`: continue as an existing workstation, e.g. after losing the browser data. */
export interface TakeOverWorkstationRequest {
  workstationId: number;
}

/** Response of registering or taking over a workstation. */
export interface WorkstationRegistration {
  /** Secret the browser stores and sends in `x-workstation-token`. */
  token: string;
  workstation: NamedRef;
}

/** `GET /api/station/me`: everything a workstation shows outside the entry list. */
export interface StationState {
  workstation: NamedRef;
  /** The active stocktake, or null if there is none. */
  stocktake: NamedRef | null;
  /** Employees logged in to this workstation. */
  employees: NamedRef[];
  /** The work area the workstation is working in. */
  workArea: (NamedRef & { status: WorkAreaStatus }) | null;
}

/** Employee of the active stocktake as seen by a workstation. */
export interface StationEmployee {
  id: number;
  name: string;
  /** Workstation the employee is logged in to; only free employees can log in. */
  workstation: NamedRef | null;
}
