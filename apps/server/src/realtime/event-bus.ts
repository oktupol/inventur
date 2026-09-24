import type { DomainEvent } from '@inventur/shared';

export type EventListener = (event: DomainEvent) => void;

/** Server-internal bus: domain logic publishes events, the realtime hub distributes them. */
export class EventBus {
  private readonly listeners = new Set<EventListener>();

  publish(event: DomainEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
