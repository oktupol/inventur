/**
 * Channels a realtime client can subscribe to:
 * - `admin`: the admin dashboard, receives every event
 * - `workstations`: all workstations, e.g. for the list of work areas or free employees
 * - `workstation:<id>`: a single workstation
 * - `work_area:<id>`: everyone working in a work area, e.g. for its entry list
 */
export type Channel = 'admin' | 'workstations' | `workstation:${number}` | `work_area:${number}`;

export const adminChannel = 'admin' satisfies Channel;
export const workstationsChannel = 'workstations' satisfies Channel;

export function workstationChannel(workstationId: number): Channel {
  return `workstation:${workstationId}`;
}

export function workAreaChannel(workAreaId: number): Channel {
  return `work_area:${workAreaId}`;
}

const ID_CHANNEL = /^(workstation|work_area):([1-9]\d{0,15})$/;

export function isChannel(value: unknown): value is Channel {
  if (value === adminChannel || value === workstationsChannel) return true;
  return typeof value === 'string' && ID_CHANNEL.test(value);
}
