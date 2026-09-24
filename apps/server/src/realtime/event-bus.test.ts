import type { DomainEvent } from '@inventur/shared';
import { describe, expect, it, vi } from 'vitest';
import { EventBus } from './event-bus.ts';

const event: DomainEvent = { type: 'stocktake.changed', action: 'created', stocktakeId: 1 };

describe('EventBus', () => {
  it('passes published events to all listeners until they unsubscribe', () => {
    const bus = new EventBus();
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribeFirst = bus.subscribe(first);
    bus.subscribe(second);

    bus.publish(event);
    unsubscribeFirst();
    bus.publish(event);

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
  });
});
