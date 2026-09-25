import type { AuditLogEntry, Stocktake } from '@inventur/shared';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App.tsx';
import { RealtimeProvider } from '../realtime/RealtimeProvider.tsx';
import { stubApi } from '../test-utils/fake-api.ts';
import { createFakeRealtime } from '../test-utils/fake-realtime.ts';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const stocktake: Stocktake = {
  id: 1,
  name: 'Inventur 2026',
  status: 'active',
  startedAt: '2026-01-02T08:00:00.000Z',
  finishedAt: null,
};

function change(id: number, overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    id,
    action: 'quantity_changed',
    entryId: 7,
    workArea: { id: 1, name: 'Vitrine 1' },
    description: `Herrenuhr ${id}`,
    code: '4000000000017',
    oldValue: '1',
    newValue: '3',
    source: 'station',
    workstation: { id: 2, name: 'Kasse' },
    employees: ['Anna', 'Ben'],
    createdAt: '2026-01-02T09:00:00.000Z',
    ...overrides,
  };
}

function renderAdmin(path: string) {
  const realtime = createFakeRealtime();
  render(
    <RealtimeProvider client={realtime.client}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </RealtimeProvider>,
  );
  act(() => realtime.latest().open());
  return realtime;
}

function stubLog() {
  return stubApi(({ url }) => {
    if (url === '/api/admin/stocktakes/active') return { body: { stocktake } };
    if (url === '/api/admin/stocktakes/1') return { body: stocktake };
    if (url === '/api/admin/stocktakes/1/work-areas') return { body: [] };
    if (url === '/api/admin/workstations') return { body: [] };
    if (url === '/api/admin/stocktakes/1/audit-log') {
      return {
        body: {
          entries: [
            change(3, { action: 'deleted', oldValue: '2', newValue: null, source: 'phone' }),
            change(2),
          ],
          hasMore: true,
        },
      };
    }
    if (url === '/api/admin/stocktakes/1/audit-log?before=2') {
      return { body: { entries: [change(1)], hasMore: false } };
    }
    if (url === '/api/admin/stocktakes/1/audit-log?action=deleted') {
      return { body: { entries: [change(3, { action: 'deleted' })], hasMore: false } };
    }
    return undefined;
  });
}

describe('audit log page', () => {
  it('lists the changes with who made them', async () => {
    stubLog();
    renderAdmin('/admin/protokoll');

    const deleted = (await screen.findByText('Herrenuhr 3')).closest('tr')!;
    expect(within(deleted).getByText('Zeile gelöscht')).toBeTruthy();
    expect(within(deleted).getByText('Menge 2')).toBeTruthy();
    expect(within(deleted).getByText('(Handy)')).toBeTruthy();
    expect(within(deleted).getByText('Anna, Ben')).toBeTruthy();
    const changed = screen.getByText('Herrenuhr 2').closest('tr')!;
    expect(within(changed).getByText('1 → 3')).toBeTruthy();
  });

  it('loads older entries on request', async () => {
    const api = stubLog();
    renderAdmin('/admin/protokoll');
    fireEvent.click(await screen.findByRole('button', { name: 'Ältere Einträge laden' }));

    expect(await screen.findByText('Herrenuhr 1')).toBeTruthy();
    expect(api.calls.some((c) => c.url.endsWith('?before=2'))).toBe(true);
    expect(screen.queryByRole('button', { name: 'Ältere Einträge laden' })).toBeNull();
  });

  it('filters by action and exports with the filters', async () => {
    stubLog();
    renderAdmin('/admin/protokoll');
    await screen.findByText('Herrenuhr 2');

    fireEvent.change(screen.getByLabelText('Aktion'), { target: { value: 'deleted' } });
    await waitFor(() => expect(screen.queryByText('Herrenuhr 2')).toBeNull());
    expect(screen.getByText('Herrenuhr 3')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'CSV' }).getAttribute('href')).toBe(
      '/api/admin/stocktakes/1/audit-log/export?action=deleted&format=csv',
    );
  });

  it('reloads on changes of entries', async () => {
    const api = stubLog();
    const realtime = renderAdmin('/admin/protokoll');
    await screen.findByText('Herrenuhr 2');
    const before = api.calls.filter((c) => c.url === '/api/admin/stocktakes/1/audit-log').length;

    act(() =>
      realtime.latest().receive({
        type: 'event',
        event: {
          type: 'entry.changed',
          action: 'updated',
          stocktakeId: 1,
          workAreaId: 1,
          entryId: 7,
        },
      }),
    );
    await waitFor(
      () =>
        expect(
          api.calls.filter((c) => c.url === '/api/admin/stocktakes/1/audit-log').length,
        ).toBeGreaterThan(before),
      { timeout: 2000 },
    );
  });
});
