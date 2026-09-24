import type { Channel } from './channels.ts';
import { channelsForEvent, type DomainEvent } from './events.ts';
import { parseServerMessage, type ClientMessage } from './messages.ts';

/** `closed` means the connection is lost; the client keeps retrying until stopped. */
export type ConnectionStatus = 'connecting' | 'open' | 'closed';

/** The subset of the WebSocket API used by the client, so tests can inject a fake. */
export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  onopen: ((event: unknown) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
}

export interface RealtimeClientOptions {
  url: string;
  createSocket?: (url: string) => WebSocketLike;
  /** Interval between heartbeat pings while connected. */
  heartbeatIntervalMs?: number;
  /** Time to wait for any message after a ping before the connection counts as lost. */
  heartbeatTimeoutMs?: number;
  /** Delay before the n-th reconnect attempt (starting at 0). */
  reconnectDelayMs?: (attempt: number) => number;
}

export type EventHandler = (event: DomainEvent) => void;

const OPEN = 1;

/** Browsers and Node.js ≥ 22 provide a global WebSocket. */
interface GlobalWithWebSocket {
  WebSocket: new (url: string) => WebSocketLike;
}

/** Exponential backoff: 0.5 s, 1 s, 2 s, 4 s, then 5 s. */
export function backoffDelayMs(attempt: number): number {
  return Math.min(5000, 500 * 2 ** attempt);
}

interface Subscription {
  channels: readonly Channel[];
  handler: EventHandler;
}

/**
 * WebSocket client with automatic reconnect, heartbeat and channel
 * subscriptions that survive reconnects.
 */
export class RealtimeClient {
  private readonly options: Required<RealtimeClientOptions>;
  private socket: WebSocketLike | undefined;
  private currentStatus: ConnectionStatus = 'closed';
  private running = false;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private heartbeatTimeout: ReturnType<typeof setTimeout> | undefined;
  private readonly subscriptions = new Set<Subscription>();
  private readonly channelCounts = new Map<Channel, number>();
  private readonly statusListeners = new Set<(status: ConnectionStatus) => void>();

  constructor(options: RealtimeClientOptions) {
    this.options = {
      createSocket: (url) => new (globalThis as unknown as GlobalWithWebSocket).WebSocket(url),
      heartbeatIntervalMs: 10_000,
      heartbeatTimeoutMs: 5_000,
      reconnectDelayMs: backoffDelayMs,
      ...options,
    };
  }

  get status(): ConnectionStatus {
    return this.currentStatus;
  }

  onStatusChange(listener: (status: ConnectionStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.connect();
  }

  stop(): void {
    this.running = false;
    clearTimeout(this.reconnectTimer);
    this.disconnect();
    this.setStatus('closed');
  }

  /** Receives the events of the given channels until the returned function is called. */
  subscribe(channels: readonly Channel[], handler: EventHandler): () => void {
    const subscription: Subscription = { channels: [...new Set(channels)], handler };
    this.subscriptions.add(subscription);
    const added = subscription.channels.filter((channel) => this.increment(channel, 1) === 1);
    if (added.length > 0) this.send({ type: 'subscribe', channels: added });

    return () => {
      if (!this.subscriptions.delete(subscription)) return;
      const removed = subscription.channels.filter((channel) => this.increment(channel, -1) === 0);
      if (removed.length > 0) this.send({ type: 'unsubscribe', channels: removed });
    };
  }

  private increment(channel: Channel, delta: number): number {
    const count = (this.channelCounts.get(channel) ?? 0) + delta;
    if (count === 0) this.channelCounts.delete(channel);
    else this.channelCounts.set(channel, count);
    return count;
  }

  private connect(): void {
    this.setStatus('connecting');
    const socket = this.options.createSocket(this.options.url);
    this.socket = socket;

    socket.onopen = () => {
      this.attempt = 0;
      this.setStatus('open');
      const channels = [...this.channelCounts.keys()];
      if (channels.length > 0) this.send({ type: 'subscribe', channels });
      this.startHeartbeat();
    };
    socket.onmessage = ({ data }) => {
      clearTimeout(this.heartbeatTimeout);
      if (typeof data !== 'string') return;
      const message = parseServerMessage(data);
      if (message?.type === 'event') this.dispatch(message.event);
    };
    socket.onclose = () => this.handleLost();
    socket.onerror = () => this.handleLost();
  }

  private disconnect(): void {
    clearInterval(this.heartbeatTimer);
    clearTimeout(this.heartbeatTimeout);
    const socket = this.socket;
    this.socket = undefined;
    if (!socket) return;
    socket.onopen = socket.onclose = socket.onerror = socket.onmessage = null;
    socket.close();
  }

  private handleLost(): void {
    this.disconnect();
    if (!this.running) return;
    this.setStatus('closed');
    this.reconnectTimer = setTimeout(
      () => this.connect(),
      this.options.reconnectDelayMs(this.attempt++),
    );
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      this.send({ type: 'ping' });
      clearTimeout(this.heartbeatTimeout);
      this.heartbeatTimeout = setTimeout(() => this.handleLost(), this.options.heartbeatTimeoutMs);
    }, this.options.heartbeatIntervalMs);
  }

  private send(message: ClientMessage): void {
    if (this.socket?.readyState === OPEN) this.socket.send(JSON.stringify(message));
  }

  private dispatch(event: DomainEvent): void {
    const channels = new Set(channelsForEvent(event));
    for (const { channels: subscribed, handler } of this.subscriptions) {
      if (subscribed.some((channel) => channels.has(channel))) handler(event);
    }
  }

  private setStatus(status: ConnectionStatus): void {
    if (status === this.currentStatus) return;
    this.currentStatus = status;
    for (const listener of this.statusListeners) listener(status);
  }
}
