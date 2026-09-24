import type { NamedRef } from './common.ts';

export type WorkAreaStatus = 'open' | 'in_progress' | 'closed';

export interface WorkArea {
  id: number;
  stocktakeId: number;
  name: string;
  description: string | null;
  status: WorkAreaStatus;
  closedAt: string | null;
  entryCount: number;
  /** Sum of the quantities of all entries. */
  quantity: number;
  /** Workstations currently working in the area. */
  workstations: NamedRef[];
}

/** `POST /api/stocktakes/:id/work-areas` */
export interface CreateWorkAreaRequest {
  name: string;
  description?: string | null;
}

/** `PATCH /api/stocktakes/:id/work-areas/:workAreaId` */
export interface UpdateWorkAreaRequest {
  name?: string;
  description?: string | null;
}
