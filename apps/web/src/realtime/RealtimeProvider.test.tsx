import type { Channel, DomainEvent } from '@inventur/shared';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createFakeRealtime } from '../test-utils/fake-realtime.ts';
import { ConnectionIndicator } from './ConnectionIndicator.tsx';
import { RealtimeProvider, realtimeUrl, useRealtimeEvents } from './RealtimeProvider.tsx';

afterEach(cleanup);

describe('realtimeUrl', () => {
  it('uses ws on HTTP and wss on HTTPS', () => {
    expect(realtimeUrl({ protocol: 'http:', host: 'server' })).toBe('ws://server/api/ws');
    expect(realtimeUrl({ protocol: 'https:', host: '10.0.0.5' })).toBe('wss://10.0.0.5/api/ws');
  });
});

describe('ConnectionIndicator', () => {
  it('shows the connection status', () => {
    const fake = createFakeRealtime();
    render(
      <RealtimeProvider client={fake.client}>
        <ConnectionIndicator />
      </RealtimeProvider>,
    );
    const status = () => screen.getByRole('status').textContent;
    expect(status()).toBe('Verbindung wird hergestellt …');
    act(() => fake.latest().open());
    expect(status()).toBe('Verbunden');
    act(() => fake.latest().drop());
    expect(status()).toBe('Keine Verbindung zum Server');
  });
});

describe('useRealtimeEvents', () => {
  const event: DomainEvent = {
    type: 'entry.changed',
    action: 'created',
    stocktakeId: 1,
    workAreaId: 4,
    entryId: 9,
  };

  function Listener({ channels, log }: { channels: Channel[]; log: DomainEvent[] }) {
    useRealtimeEvents(channels, (e) => log.push(e));
    return null;
  }

  it('subscribes while mounted and receives matching events', () => {
    const fake = createFakeRealtime();
    const log: DomainEvent[] = [];
    const { unmount } = render(
      <RealtimeProvider client={fake.client}>
        <Listener channels={['work_area:4']} log={log} />
      </RealtimeProvider>,
    );
    act(() => fake.latest().open());
    expect(fake.latest().sent).toContainEqual({ type: 'subscribe', channels: ['work_area:4'] });

    act(() => fake.latest().receive({ type: 'event', event }));
    expect(log).toEqual([event]);

    unmount();
    expect(fake.client.status).toBe('closed');
  });

  it('ignores events of other channels', () => {
    const fake = createFakeRealtime();
    const log: DomainEvent[] = [];
    render(
      <RealtimeProvider client={fake.client}>
        <Listener channels={['work_area:5']} log={log} />
      </RealtimeProvider>,
    );
    act(() => fake.latest().open());
    act(() => fake.latest().receive({ type: 'event', event }));
    expect(log).toEqual([]);
  });
});
