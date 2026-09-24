import type { NamedRef } from './common.ts';

export interface Workstation {
  id: number;
  name: string;
  workArea: NamedRef | null;
  lastSeenAt: string | null;
  /** Employees currently logged in. */
  employees: NamedRef[];
  /** Entries across all stocktakes; only workstations without entries can be deleted. */
  entryCount: number;
}

/** `PATCH /api/workstations/:id` */
export interface RenameWorkstationRequest {
  name: string;
}
