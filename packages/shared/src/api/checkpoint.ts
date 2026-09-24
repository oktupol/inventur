import type { NamedRef } from './common.ts';

/**
 * A mark in the entry list of a work area that forms a subtotal. Counts are
 * pieces (sums of quantities); a line belongs to the section in which it was
 * created, and the counts follow later changes and deletions.
 */
export interface Checkpoint {
  id: number;
  workAreaId: number;
  /**
   * Position within the work area, starting at 1. It changes when an earlier
   * checkpoint is deleted or inserted.
   */
  number: number;
  workstation: NamedRef | null;
  createdAt: string;
  /** Pieces since the previous checkpoint, or since the start for the first one. */
  sinceLast: number;
  /** Pieces since the start of the work area. */
  sinceStart: number;
}

/**
 * `POST /api/station/checkpoints`: at the end of the list, or after the line
 * `afterEntryId`. Every section must keep at least one line.
 */
export interface CreateCheckpointRequest {
  afterEntryId?: number;
}
