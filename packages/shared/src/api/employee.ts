import type { NamedRef } from './common.ts';

export interface Employee {
  id: number;
  stocktakeId: number;
  name: string;
  /** Workstation the employee is logged in to. */
  workstation: NamedRef | null;
  /** Number of entries the employee took part in; only employees without entries can be removed. */
  entryCount: number;
}

/** `POST /api/admin/stocktakes/:id/employees` */
export interface CreateEmployeeRequest {
  name: string;
}
