import {
  adminChannel,
  workAreaChannel,
  workstationChannel,
  workstationsChannel,
  type Channel,
} from './channels.ts';

export type ChangeAction = 'created' | 'updated' | 'deleted';

/**
 * Domain events sent to clients. They only carry ids; clients reload the
 * affected data. Every change to stocktakes, work areas, workstations,
 * employees, entries, checkpoints or pairings publishes one of these events.
 */
export type DomainEvent =
  | { type: 'stocktake.changed'; action: ChangeAction; stocktakeId: number }
  | { type: 'work_area.changed'; action: ChangeAction; stocktakeId: number; workAreaId: number }
  | { type: 'workstation.changed'; action: ChangeAction; workstationId: number }
  | { type: 'employee.changed'; action: ChangeAction; stocktakeId: number; employeeId: number }
  | {
      type: 'entry.changed';
      action: ChangeAction;
      stocktakeId: number;
      workAreaId: number;
      entryId: number;
    }
  | { type: 'pairing.changed'; action: ChangeAction; workstationId: number; pairingId: number }
  | {
      /** A paired phone captured a code for the workstation, which shows the result too. */
      type: 'phone_scan.result';
      workstationId: number;
      input: string;
      result: 'unique' | 'ambiguous' | 'not_found';
      entryId: number | null;
      description: string | null;
    }
  | {
      type: 'checkpoint.changed';
      action: ChangeAction;
      stocktakeId: number;
      workAreaId: number;
      checkpointId: number;
    };

export type DomainEventType = DomainEvent['type'];

/** Determines which channels receive an event. The admin channel receives everything. */
export function channelsForEvent(event: DomainEvent): Channel[] {
  switch (event.type) {
    case 'stocktake.changed':
      // Starting or finishing a stocktake changes what every workstation shows.
      return [adminChannel, workstationsChannel];
    case 'work_area.changed':
      // Work area status is visible on all workstations.
      return [adminChannel, workstationsChannel, workAreaChannel(event.workAreaId)];
    case 'phone_scan.result':
      return [workstationChannel(event.workstationId)];
    case 'workstation.changed':
    case 'pairing.changed':
      // Paired phones listen on the channel of their workstation.
      return [adminChannel, workstationChannel(event.workstationId)];
    case 'employee.changed':
      // Workstations list the employees that are still free.
      return [adminChannel, workstationsChannel];
    case 'entry.changed':
    case 'checkpoint.changed':
      return [adminChannel, workAreaChannel(event.workAreaId)];
  }
}
