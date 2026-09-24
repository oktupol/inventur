import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backoffDelayMs, RealtimeClient, type WebSocketLike } from './client.ts';
import type { DomainEvent } from './events.ts';

class FakeSocket implements WebSocketLike {
  readyState = 0;
  sent: unknown[] = [];
  closed = false;
  onopen: WebSocketLike['onopen'] = null;
  onclose: WebSocketLike['onclose'] = null;
  onerror: WebSocketLike['onerror'] = null;
  onmessage: WebSocketLike['onmessage'] = null;

  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.closed = true;
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  receive(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
  drop() {
    this.readyState = 3;
    this.onclose?.({});
  }
}

const entryEvent = (workAreaId: number): DomainEvent => ({
  type: 'entry.changed',
  action: 'created',
  stocktakeId: 1,
  workAreaId,
  entryId: 1,
});

describe('RealtimeClient', () => {
  let sockets: FakeSocket[];
  let client: RealtimeClient;
  const latest = () => sockets[sockets.length - 1]!;

  beforeEach(() => {
    vi.useFakeTimers();
    sockets = [];
    client = new RealtimeClient({
      url: 'ws://test/api/ws',
      createSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
    });
  });

  afterEach(() => {
    client.stop();
    vi.useRealTimers();
  });

  it('reports the connection status', () => {
    const statuses: string[] = [];
    client.onStatusChange((status) => statuses.push(status));
    client.start();
    latest().open();
    latest().drop();
    expect(statuses).toEqual(['connecting', 'open', 'closed']);
  });

  it('subscribes to all channels once the connection is open', () => {
    client.subscribe(['admin'], () => {});
    client.subscribe(['work_area:1', 'admin'], () => {});
    client.start();
    expect(latest().sent).toEqual([]);
    latest().open();
    expect(latest().sent).toEqual([{ type: 'subscribe', channels: ['admin', 'work_area:1'] }]);
  });

  it('only sends subscribe and unsubscribe for the first and last subscriber of a channel', () => {
    client.start();
    latest().open();
    const first = client.subscribe(['work_area:1'], () => {});
    const second = client.subscribe(['work_area:1'], () => {});
    first();
    second();
    second();
    expect(latest().sent).toEqual([
      { type: 'subscribe', channels: ['work_area:1'] },
      { type: 'unsubscribe', channels: ['work_area:1'] },
    ]);
  });

  it('passes events only to handlers of matching channels', () => {
    const area1 = vi.fn();
    const area2 = vi.fn();
    const admin = vi.fn();
    client.subscribe(['work_area:1'], area1);
    client.subscribe(['work_area:2'], area2);
    client.subscribe(['admin', 'work_area:1'], admin);
    client.start();
    latest().open();
    latest().receive({ type: 'event', event: entryEvent(1) });
    expect(area1).toHaveBeenCalledWith(entryEvent(1));
    expect(area2).not.toHaveBeenCalled();
    expect(admin).toHaveBeenCalledTimes(1);
  });

  it('reconnects with backoff and resubscribes', () => {
    client.subscribe(['workstations'], () => {});
    client.start();
    latest().open();
    latest().drop();
    expect(client.status).toBe('closed');

    vi.advanceTimersByTime(backoffDelayMs(0) - 1);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);
    expect(client.status).toBe('connecting');

    latest().drop(); // server still down
    vi.advanceTimersByTime(backoffDelayMs(1));
    expect(sockets).toHaveLength(3);
    latest().open();
    expect(client.status).toBe('open');
    expect(latest().sent).toEqual([{ type: 'subscribe', channels: ['workstations'] }]);

    // The backoff starts over after a successful connection.
    latest().drop();
    vi.advanceTimersByTime(backoffDelayMs(0));
    expect(sockets).toHaveLength(4);
  });

  it('treats a missing heartbeat answer as a lost connection', () => {
    client.start();
    latest().open();
    vi.advanceTimersByTime(10_000);
    expect(latest().sent).toEqual([{ type: 'ping' }]);
    latest().receive({ type: 'pong' });
    vi.advanceTimersByTime(5_000);
    expect(client.status).toBe('open');

    vi.advanceTimersByTime(5_000); // next ping, no answer
    vi.advanceTimersByTime(5_000);
    expect(client.status).toBe('closed');
    expect(sockets[0]!.closed).toBe(true);
  });

  it('stops reconnecting after stop()', () => {
    client.start();
    latest().open();
    client.stop();
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);
    expect(client.status).toBe('closed');
  });
});

describe('backoffDelayMs', () => {
  it('doubles up to five seconds', () => {
    expect([0, 1, 2, 3, 4, 10].map(backoffDelayMs)).toEqual([500, 1000, 2000, 4000, 5000, 5000]);
  });
});
