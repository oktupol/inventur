import {
  channelsForEvent,
  parseClientMessage,
  type Channel,
  type DomainEvent,
  type ServerMessage,
} from '@inventur/shared';

/** A connected client, independent of the transport. */
export interface Connection {
  send(message: ServerMessage): void;
}

/** Tracks the channel subscriptions of all connections and delivers events. */
export class RealtimeHub {
  private readonly subscriptions = new Map<Connection, Set<Channel>>();

  add(connection: Connection): void {
    this.subscriptions.set(connection, new Set());
  }

  remove(connection: Connection): void {
    this.subscriptions.delete(connection);
  }

  get size(): number {
    return this.subscriptions.size;
  }

  /** Number of connections subscribed to the channel. */
  subscriberCount(channel: Channel): number {
    let count = 0;
    for (const channels of this.subscriptions.values()) if (channels.has(channel)) count++;
    return count;
  }

  channelsOf(connection: Connection): Channel[] {
    return [...(this.subscriptions.get(connection) ?? [])];
  }

  handleMessage(connection: Connection, raw: string): void {
    const channels = this.subscriptions.get(connection);
    if (!channels) return;
    const message = parseClientMessage(raw);
    if (!message) {
      connection.send({ type: 'error', message: 'Invalid message' });
      return;
    }
    switch (message.type) {
      case 'ping':
        connection.send({ type: 'pong' });
        break;
      case 'subscribe':
        for (const channel of message.channels) channels.add(channel);
        break;
      case 'unsubscribe':
        for (const channel of message.channels) channels.delete(channel);
        break;
    }
  }

  /** Sends the event once to every connection subscribed to at least one of its channels. */
  deliver(event: DomainEvent): void {
    const targets = channelsForEvent(event);
    for (const [connection, channels] of this.subscriptions) {
      if (targets.some((channel) => channels.has(channel))) {
        connection.send({ type: 'event', event });
      }
    }
  }
}
