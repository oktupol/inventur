import { REALTIME_PATH, RealtimeClient, type Channel, type DomainEvent } from '@inventur/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.ts';

/** End-to-end tests with real WebSocket connections against the server. */

async function waitFor(condition: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const entry = (workAreaId: number, entryId: number): DomainEvent => ({
  type: 'entry.changed',
  action: 'created',
  stocktakeId: 1,
  workAreaId,
  entryId,
});

describe('realtime endpoint', () => {
  const apps: FastifyInstance[] = [];
  const clients: RealtimeClient[] = [];

  afterEach(async () => {
    for (const client of clients.splice(0)) client.stop();
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  async function startApp(port = 0): Promise<{ app: FastifyInstance; port: number }> {
    const app = await buildApp({ version: 'test' });
    apps.push(app);
    await app.listen({ host: '127.0.0.1', port });
    const address = app.server.address();
    if (typeof address !== 'object' || !address) throw new Error('No address');
    return { app, port: address.port };
  }

  function connect(port: number, channels: Channel[], options = {}) {
    const client = new RealtimeClient({
      url: `ws://127.0.0.1:${port}${REALTIME_PATH}`,
      ...options,
    });
    clients.push(client);
    const received: DomainEvent[] = [];
    client.subscribe(channels, (event) => received.push(event));
    client.start();
    return { client, received };
  }

  it('delivers an event only to clients in a matching channel', async () => {
    const { app, port } = await startApp();
    const area1 = connect(port, ['work_area:1']);
    const area2 = connect(port, ['work_area:2']);
    const admin = connect(port, ['admin']);
    const stations = connect(port, ['workstations']);
    await waitFor(() =>
      (['work_area:1', 'work_area:2', 'admin', 'workstations'] as const).every(
        (channel) => app.realtime.subscriberCount(channel) === 1,
      ),
    );

    app.events.publish(entry(1, 100));
    app.events.publish(entry(2, 200));
    await waitFor(() => area2.received.length === 1 && admin.received.length === 2);

    expect(area1.received).toEqual([entry(1, 100)]);
    expect(area2.received).toEqual([entry(2, 200)]);
    expect(admin.received).toEqual([entry(1, 100), entry(2, 200)]);
    expect(stations.received).toEqual([]);
  });

  it('reconnects and resubscribes after a server restart', async () => {
    const first = await startApp();
    const { client, received } = connect(first.port, ['work_area:5'], {
      reconnectDelayMs: () => 50,
    });
    await waitFor(() => first.app.realtime.subscriberCount('work_area:5') === 1);

    await first.app.close();
    await waitFor(() => client.status !== 'open');

    const second = await startApp(first.port);
    await waitFor(() => second.app.realtime.subscriberCount('work_area:5') === 1);

    second.app.events.publish(entry(5, 1));
    await waitFor(() => received.length === 1);
    expect(received).toEqual([entry(5, 1)]);
  });
});
