import type { Db } from './db/connection.ts';
import type { EventBus } from './realtime/event-bus.ts';

/** Dependencies of the domain services. */
export interface Context {
  db: Db;
  events: EventBus;
}
