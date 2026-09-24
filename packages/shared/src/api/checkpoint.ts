import type { NamedRef } from './common.ts';

/**
 * A mark in the entry list of a work area that forms a subtotal. Counts are
 * pieces (sums of quantities); a line belongs to the section in which it was
 * created, and the counts follow later changes and deletions.
 */
export interface Checkpoint {
  id: number;
  workAreaId: number;
  /** Consecutive number within the work area, starting at 1. */
  number: number;
  workstation: NamedRef | null;
  createdAt: string;
  /** Pieces since the previous checkpoint, or since the start for the first one. */
  sinceLast: number;
  /** Pieces since the start of the work area. */
  sinceStart: number;
}
