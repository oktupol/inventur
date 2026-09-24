import type { DomainEvent, ServerMessage } from '@inventur/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { RealtimeHub, type Connection } from './hub.ts';

class FakeConnection implements Connection {
  received: ServerMessage[] = [];
  send(message: ServerMessage) {
    this.received.push(message);
  }
}

const entry = (workAreaId: number): DomainEvent => ({
  type: 'entry.changed',
  action: 'created',
  stocktakeId: 1,
  workAreaId,
  entryId: 5,
});

describe('RealtimeHub', () => {
  let hub: RealtimeHub;
  let connection: FakeConnection;

  beforeEach(() => {
    hub = new RealtimeHub();
    connection = new FakeConnection();
    hub.add(connection);
  });

  const subscribe = (c: Connection, ...channels: string[]) =>
    hub.handleMessage(c, JSON.stringify({ type: 'subscribe', channels }));

  it('tracks subscribe and unsubscribe', () => {
    subscribe(connection, 'admin', 'work_area:1');
    hub.handleMessage(connection, JSON.stringify({ type: 'unsubscribe', channels: ['admin'] }));
    expect(hub.channelsOf(connection)).toEqual(['work_area:1']);
    expect(hub.subscriberCount('work_area:1')).toBe(1);
    expect(hub.subscriberCount('admin')).toBe(0);
  });

  it('answers pings', () => {
    hub.handleMessage(connection, '{"type":"ping"}');
    expect(connection.received).toEqual([{ type: 'pong' }]);
  });

  it('reports invalid messages without changing subscriptions', () => {
    hub.handleMessage(connection, '{"type":"subscribe","channels":["everything"]}');
    expect(connection.received).toEqual([{ type: 'error', message: 'Invalid message' }]);
    expect(hub.channelsOf(connection)).toEqual([]);
  });

  it('delivers events only to connections in a matching channel', () => {
    const area1 = connection;
    const area2 = new FakeConnection();
    const admin = new FakeConnection();
    const idle = new FakeConnection();
    for (const c of [area2, admin, idle]) hub.add(c);
    subscribe(area1, 'work_area:1');
    subscribe(area2, 'work_area:2');
    subscribe(admin, 'admin');

    hub.deliver(entry(1));

    expect(area1.received).toEqual([{ type: 'event', event: entry(1) }]);
    expect(admin.received).toEqual([{ type: 'event', event: entry(1) }]);
    expect(area2.received).toEqual([]);
    expect(idle.received).toEqual([]);
  });

  it('delivers an event only once even if several channels match', () => {
    subscribe(connection, 'admin', 'work_area:1');
    hub.deliver(entry(1));
    expect(connection.received).toHaveLength(1);
  });

  it('stops delivering after the connection is removed', () => {
    subscribe(connection, 'admin');
    hub.remove(connection);
    hub.deliver(entry(1));
    expect(connection.received).toEqual([]);
    expect(hub.size).toBe(0);
  });
});
