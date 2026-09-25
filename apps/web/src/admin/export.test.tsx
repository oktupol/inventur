import type { Stocktake, WorkArea } from '@inventur/shared';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
  id: 3,
  name: 'Inventur 2026',
  status: 'finished',
  startedAt: '2026-01-02T08:00:00.000Z',
  finishedAt: '2026-01-02T18:00:00.000Z',
};

const workArea: WorkArea = {
  id: 7,
  stocktakeId: 3,
  name: 'Vitrine 1',
  description: null,
  status: 'closed',
  closedAt: null,
  entryCount: 1,
  quantity: 1,
  workstations: [],
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

describe('export', () => {
  it('offers the count list and CSV and XLSX downloads, for all work areas or one of them', async () => {
    stubApi(({ url }) => {
      if (url === '/api/admin/stocktakes/active') return { body: { stocktake: null } };
      if (url === '/api/admin/stocktakes/3') return { body: stocktake };
      if (url === '/api/admin/stocktakes/3/work-areas') return { body: [workArea] };
      if (url === '/api/admin/stocktakes/3/employees') return { body: [] };
      return undefined;
    });
    renderAdmin('/admin/historie/3');
    const card = (await screen.findByRole('heading', { name: 'Export' })).parentElement!;
    const hrefs = () =>
      within(card)
        .getAllByRole('link')
        .map((link) => link.getAttribute('href'));
    expect(hrefs()).toEqual([
      '/api/admin/stocktakes/3/count-list',
      '/api/admin/stocktakes/3/export/entries?format=csv',
      '/api/admin/stocktakes/3/export/entries?format=xlsx',
      '/api/admin/stocktakes/3/export/articles?format=csv',
      '/api/admin/stocktakes/3/export/articles?format=xlsx',
      '/api/admin/stocktakes/3/export/reconciliation?format=csv',
      '/api/admin/stocktakes/3/export/reconciliation?format=xlsx',
    ]);

    fireEvent.change(await within(card).findByRole('combobox'), { target: { value: '7' } });
    expect(hrefs()).toEqual([
      '/api/admin/stocktakes/3/count-list?workAreaId=7',
      '/api/admin/stocktakes/3/export/entries?format=csv&workAreaId=7',
      '/api/admin/stocktakes/3/export/entries?format=xlsx&workAreaId=7',
      '/api/admin/stocktakes/3/export/articles?format=csv&workAreaId=7',
      '/api/admin/stocktakes/3/export/articles?format=xlsx&workAreaId=7',
      // The comparison always covers the whole stocktake.
      '/api/admin/stocktakes/3/export/reconciliation?format=csv',
      '/api/admin/stocktakes/3/export/reconciliation?format=xlsx',
    ]);
  });
});
