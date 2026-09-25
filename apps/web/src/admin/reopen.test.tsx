import type { Stocktake, StocktakeSummary } from '@inventur/shared';
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

const finished: StocktakeSummary = {
  id: 1,
  name: 'Inventur 2025',
  status: 'finished',
  startedAt: '2025-01-02T08:00:00.000Z',
  finishedAt: '2025-01-03T18:00:00.000Z',
  workAreaCount: 2,
  closedWorkAreaCount: 2,
  employeeCount: 3,
  entryCount: 10,
  quantity: 12,
};

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
}

function stubHistory(options: { active?: Stocktake | null } = {}) {
  let active: Stocktake | null = options.active ?? null;
  return stubApi(({ method, url }) => {
    if (url === '/api/admin/stocktakes/active') return { body: { stocktake: active } };
    if (url === '/api/admin/stocktakes') return { body: [finished] };
    if (method === 'POST' && url === '/api/admin/stocktakes/1/reopen') {
      active = { ...finished, status: 'active', finishedAt: null };
      return { body: active };
    }
    if (url.startsWith('/api/admin/stocktakes/1/')) return { body: [] };
    if (url === '/api/admin/workstations') return { body: [] };
    return undefined;
  });
}

describe('reopening a stocktake', () => {
  it('reopens a finished stocktake after a confirmation', async () => {
    const api = stubHistory();
    renderAdmin('/admin/historie');
    const row = (await screen.findByText('Inventur 2025')).closest('tr')!;
    const button = within(row).getByRole<HTMLButtonElement>('button', { name: 'Wieder öffnen' });
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button);

    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Mitarbeiter müssen sich an den Stationen neu anmelden');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Wieder öffnen' }));

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0]).toMatchObject({
      method: 'POST',
      url: '/api/admin/stocktakes/1/reopen',
    });
    // The dashboard switches to the reopened stocktake.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByRole('link', { name: 'Inventur' })).toBeTruthy();
  });

  it('is not possible while another stocktake is active', async () => {
    const api = stubHistory({
      active: {
        id: 2,
        name: 'Inventur 2026',
        status: 'active',
        startedAt: '2026-01-02T08:00:00.000Z',
        finishedAt: null,
      },
    });
    renderAdmin('/admin/historie');
    const row = (await screen.findByText('Inventur 2025')).closest('tr')!;
    await screen.findByText('Inventur 2026');
    const button = within(row).getByRole<HTMLButtonElement>('button', { name: 'Wieder öffnen' });
    expect(button.disabled).toBe(true);
    expect(button.title).toContain('andere Inventur aktiv');
    expect(api.writes()).toEqual([]);
  });
});
