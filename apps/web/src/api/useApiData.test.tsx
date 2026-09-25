import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RealtimeProvider } from '../realtime/RealtimeProvider.tsx';
import { stubApi } from '../test-utils/fake-api.ts';
import { createFakeRealtime } from '../test-utils/fake-realtime.ts';
import { useApiData } from './useApiData.ts';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function Value({ url }: { url: string | null }) {
  const { data, error, loading } = useApiData<{ value: number }>(url, {
    channels: ['admin'],
    filter: (event) => event.type === 'stocktake.changed',
  });
  if (loading) return <p>lädt</p>;
  return <p>{error ? error.message : data?.value}</p>;
}

describe('useApiData', () => {
  it('loads data, reloads on matching events and after a reconnect', async () => {
    vi.useFakeTimers();
    let value = 1;
    const api = stubApi(() => ({ body: { value } }));
    const realtime = createFakeRealtime({ reconnectDelayMs: () => 10 });
    render(
      <RealtimeProvider client={realtime.client}>
        <Value url="/api/x" />
      </RealtimeProvider>,
    );
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByText('1')).toBeTruthy();
    act(() => realtime.latest().open());

    // Events of other types are ignored.
    value = 2;
    act(() =>
      realtime.latest().receive({
        type: 'event',
        event: { type: 'workstation.changed', action: 'updated', workstationId: 1 },
      }),
    );
    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(screen.getByText('1')).toBeTruthy();

    // A burst of matching events causes a single reload.
    const event = { type: 'stocktake.changed', action: 'updated', stocktakeId: 1 };
    act(() => {
      realtime.latest().receive({ type: 'event', event });
      realtime.latest().receive({ type: 'event', event });
    });
    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(screen.getByText('2')).toBeTruthy();
    expect(api.calls).toHaveLength(2);

    // Events may be missed while disconnected, so a reconnect reloads.
    value = 3;
    act(() => realtime.latest().drop());
    await act(() => vi.advanceTimersByTimeAsync(20));
    act(() => realtime.latest().open());
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByText('3')).toBeTruthy();
    expect(api.calls).toHaveLength(3);
  });

  it('reloads at most once per interval when throttled', async () => {
    vi.useFakeTimers();
    let value = 1;
    const api = stubApi(() => ({ body: { value: value++ } }));
    const realtime = createFakeRealtime();
    function Throttled() {
      const { data } = useApiData<{ value: number }>('/api/x', {
        channels: ['admin'],
        throttleMs: 1000,
      });
      return <p>{data?.value}</p>;
    }
    render(
      <RealtimeProvider client={realtime.client}>
        <Throttled />
      </RealtimeProvider>,
    );
    await act(() => vi.advanceTimersByTimeAsync(0));
    act(() => realtime.latest().open());
    const event = { type: 'stocktake.changed', action: 'updated', stocktakeId: 1 };

    // A steady stream of events reloads once per interval instead of never.
    for (let i = 0; i < 10; i++) {
      act(() => realtime.latest().receive({ type: 'event', event }));
      await act(() => vi.advanceTimersByTimeAsync(300));
    }
    expect(api.calls).toHaveLength(3);
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(api.calls).toHaveLength(4);
    expect(screen.getByText('4')).toBeTruthy();
  });

  it('shows errors and loads nothing without a URL', async () => {
    const api = stubApi(() => ({ status: 404, body: { error: 'x', code: 'not_found' } }));
    const realtime = createFakeRealtime();
    const { rerender } = render(
      <RealtimeProvider client={realtime.client}>
        <Value url={null} />
      </RealtimeProvider>,
    );
    expect(api.calls).toEqual([]);
    rerender(
      <RealtimeProvider client={realtime.client}>
        <Value url="/api/missing" />
      </RealtimeProvider>,
    );
    expect(await screen.findByText(/nicht gefunden/)).toBeTruthy();
  });
});
