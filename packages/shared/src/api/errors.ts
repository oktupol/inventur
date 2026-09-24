/**
 * Machine-readable error codes of the HTTP API. The `error` text of a response
 * is English and meant for logs; the frontend shows German texts per code.
 */
export type ErrorCode =
  | 'validation_failed'
  | 'not_found'
  | 'stocktake_already_active'
  | 'stocktake_finished'
  | 'unclosed_work_areas'
  | 'name_taken'
  | 'employee_has_entries'
  | 'work_area_has_entries'
  | 'workstation_has_entries'
  | 'no_previous_stocktake'
  | 'workstation_unknown'
  | 'no_active_stocktake'
  | 'employee_busy'
  | 'employee_not_logged_in'
  | 'work_area_closed'
  | 'not_in_work_area'
  | 'no_work_area'
  | 'no_employee_logged_in'
  | 'checkpoint_empty_section'
  | 'internal_error';

/** Body of every error response. */
export interface ApiError {
  error: string;
  code: ErrorCode;
  /** Additional data for some codes, e.g. the unclosed work areas. */
  details?: unknown;
}

export function isApiError(value: unknown): value is ApiError {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.error === 'string' && typeof candidate.code === 'string';
}
