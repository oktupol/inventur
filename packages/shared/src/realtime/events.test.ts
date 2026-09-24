import { describe, expect, it } from 'vitest';
import { channelsForEvent, type DomainEvent } from './events.ts';

describe('channelsForEvent', () => {
  it.each<[DomainEvent, string[]]>([
    [{ type: 'stocktake.changed', action: 'created', stocktakeId: 1 }, ['admin', 'workstations']],
    [
      { type: 'work_area.changed', action: 'updated', stocktakeId: 1, workAreaId: 7 },
      ['admin', 'workstations', 'work_area:7'],
    ],
    [
      { type: 'workstation.changed', action: 'updated', workstationId: 3 },
      ['admin', 'workstation:3'],
    ],
    [
      { type: 'employee.changed', action: 'deleted', stocktakeId: 1, employeeId: 9 },
      ['admin', 'workstations'],
    ],
    [
      { type: 'entry.changed', action: 'created', stocktakeId: 1, workAreaId: 7, entryId: 100 },
      ['admin', 'work_area:7'],
    ],
    [
      {
        type: 'checkpoint.changed',
        action: 'created',
        stocktakeId: 1,
        workAreaId: 8,
        checkpointId: 2,
      },
      ['admin', 'work_area:8'],
    ],
  ])('routes %j to %j', (event, channels) => {
    expect(channelsForEvent(event)).toEqual(channels);
  });
});
