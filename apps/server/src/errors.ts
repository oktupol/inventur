import type { ErrorCode } from '@inventur/shared';

const STATUS_CODES: Record<ErrorCode, number> = {
  validation_failed: 400,
  not_found: 404,
  stocktake_already_active: 409,
  stocktake_finished: 409,
  unclosed_work_areas: 409,
  name_taken: 409,
  employee_has_entries: 409,
  work_area_has_entries: 409,
  workstation_has_entries: 409,
  no_previous_stocktake: 409,
  internal_error: 500,
};

/** A violated business rule. The HTTP layer turns it into an error response. */
export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.statusCode = STATUS_CODES[code];
    this.details = details;
  }
}
