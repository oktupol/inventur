import websocket from '@fastify/websocket';
import { REALTIME_PATH } from '@inventur/shared';
import type { FastifyInstance } from 'fastify';
import type { EventBus } from './event-bus.ts';
import { RealtimeHub, type Connection } from './hub.ts';

export interface RealtimeOptions {
  events: EventBus;
  /** Interval of protocol-level pings that detect dead connections. */
  pingIntervalMs?: number;
}

/** Registers the WebSocket endpoint and forwards events from the bus to subscribed clients. */
export async function registerRealtime(
  app: FastifyInstance,
  { events, pingIntervalMs = 30_000 }: RealtimeOptions,
): Promise<RealtimeHub> {
  const hub = new RealtimeHub();
  await app.register(websocket);

  const unsubscribe = events.subscribe((event) => hub.deliver(event));

  const alive = new WeakMap<object, boolean>();
  const pingTimer = setInterval(() => {
    for (const socket of app.websocketServer.clients) {
      if (alive.get(socket) === false) {
        socket.terminate();
        continue;
      }
      alive.set(socket, false);
      socket.ping();
    }
  }, pingIntervalMs);

  app.addHook('onClose', async () => {
    clearInterval(pingTimer);
    unsubscribe();
  });

  app.get(REALTIME_PATH, { websocket: true }, (socket) => {
    const connection: Connection = {
      send: (message) => {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
      },
    };
    hub.add(connection);
    alive.set(socket, true);

    socket.on('pong', () => alive.set(socket, true));
    socket.on('message', (data, isBinary) => {
      if (isBinary) return;
      hub.handleMessage(connection, data.toString());
    });
    socket.on('close', () => hub.remove(connection));
  });

  return hub;
}
