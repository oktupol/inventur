import { isChannel, type Channel } from './channels.ts';
import type { DomainEvent } from './events.ts';

/** Path of the WebSocket endpoint. */
export const REALTIME_PATH = '/api/ws';

export type ClientMessage =
  | { type: 'subscribe'; channels: Channel[] }
  | { type: 'unsubscribe'; channels: Channel[] }
  | { type: 'ping' };

export type ServerMessage =
  { type: 'event'; event: DomainEvent } | { type: 'pong' } | { type: 'error'; message: string };

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Validates a message received from a client. Returns null for invalid messages. */
export function parseClientMessage(raw: string): ClientMessage | null {
  const message = parseJson(raw);
  if (!isObject(message)) return null;
  switch (message.type) {
    case 'ping':
      return { type: 'ping' };
    case 'subscribe':
    case 'unsubscribe': {
      const { channels } = message;
      if (!Array.isArray(channels) || !channels.every(isChannel)) return null;
      return { type: message.type, channels };
    }
    default:
      return null;
  }
}

/**
 * Parses a message received from the server. The server is trusted, so only
 * the envelope is checked.
 */
export function parseServerMessage(raw: string): ServerMessage | null {
  const message = parseJson(raw);
  if (!isObject(message)) return null;
  switch (message.type) {
    case 'pong':
      return { type: 'pong' };
    case 'event':
      return isObject(message.event) && typeof message.event.type === 'string'
        ? { type: 'event', event: message.event as DomainEvent }
        : null;
    case 'error':
      return typeof message.message === 'string'
        ? { type: 'error', message: message.message }
        : null;
    default:
      return null;
  }
}
