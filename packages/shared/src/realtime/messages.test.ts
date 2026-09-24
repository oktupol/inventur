import { describe, expect, it } from 'vitest';
import { parseClientMessage, parseServerMessage } from './messages.ts';

describe('parseClientMessage', () => {
  it('parses valid messages', () => {
    expect(parseClientMessage('{"type":"ping"}')).toEqual({ type: 'ping' });
    expect(parseClientMessage('{"type":"subscribe","channels":["admin","work_area:1"]}')).toEqual({
      type: 'subscribe',
      channels: ['admin', 'work_area:1'],
    });
    expect(parseClientMessage('{"type":"unsubscribe","channels":[]}')).toEqual({
      type: 'unsubscribe',
      channels: [],
    });
  });

  it.each([
    'not json',
    'null',
    '[]',
    '{"type":"unknown"}',
    '{"type":"subscribe"}',
    '{"type":"subscribe","channels":"admin"}',
    '{"type":"subscribe","channels":["admin","secret"]}',
  ])('rejects %s', (raw) => {
    expect(parseClientMessage(raw)).toBeNull();
  });
});

describe('parseServerMessage', () => {
  it('parses valid messages', () => {
    expect(parseServerMessage('{"type":"pong"}')).toEqual({ type: 'pong' });
    expect(parseServerMessage('{"type":"error","message":"x"}')).toEqual({
      type: 'error',
      message: 'x',
    });
    const event = { type: 'stocktake.changed', action: 'created', stocktakeId: 1 };
    expect(parseServerMessage(JSON.stringify({ type: 'event', event }))).toEqual({
      type: 'event',
      event,
    });
  });

  it.each(['', '{}', '{"type":"event"}', '{"type":"error"}'])('rejects %j', (raw) => {
    expect(parseServerMessage(raw)).toBeNull();
  });
});
