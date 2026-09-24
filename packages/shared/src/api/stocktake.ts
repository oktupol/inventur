import type { WorkAreaStatus } from './work-area.ts';

export type StocktakeStatus = 'active' | 'finished';

export interface Stocktake {
  id: number;
  name: string;
  status: StocktakeStatus;
  /** ISO 8601 timestamps. */
  startedAt: string;
  finishedAt: string | null;
}

/** Entry of the stocktake history with key figures. */
export interface StocktakeSummary extends Stocktake {
  workAreaCount: number;
  closedWorkAreaCount: number;
  employeeCount: number;
  entryCount: number;
  /** Sum of the quantities of all entries. */
  quantity: number;
}

/** `GET /api/admin/stocktakes/active` */
export interface ActiveStocktakeResponse {
  stocktake: Stocktake | null;
}

/** `POST /api/admin/stocktakes` */
export interface StartStocktakeRequest {
  name: string;
}

/**
 * `POST /api/admin/stocktakes/:id/finish`. Without `confirm`, finishing is rejected
 * with `unclosed_work_areas` while work areas are not closed.
 */
export interface FinishStocktakeRequest {
  confirm?: boolean;
}

/** `details` of the error `unclosed_work_areas`. */
export interface UnclosedWorkAreasDetails {
  workAreas: { id: number; name: string; status: Exclude<WorkAreaStatus, 'closed'> }[];
}
