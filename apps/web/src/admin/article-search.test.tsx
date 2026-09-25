import type {
  FoundArticle,
  Reconciliation,
  Stocktake,
  StocktakeArticleDetail,
  StocktakeStatistics,
} from '@inventur/shared';
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

const watch: FoundArticle = {
  articleId: 5,
  description: 'Herrenuhr Automatik',
  ean: '4000000000017',
  articleNumbers: ['HU-100'],
  category: 'Uhren',
  priceGross: '1190.00',
  inMasterData: true,
  expectedQuantity: 2,
  countedQuantity: 1,
  lines: 1,
};

const detail: StocktakeArticleDetail = {
  article: watch,
  entries: [
    {
      id: 11,
      articleId: 5,
      isManual: false,
      description: 'Herrenuhr Automatik',
      code: '4000000000017',
      serialNumber: 'SN-4711',
      quantity: 1,
      priceGross: '1190.00',
      workArea: { id: 1, name: 'Vitrine 1' },
      workstation: { id: 2, name: 'Kasse' },
      employees: ['Anna'],
      createdAt: '2026-01-02T09:00:00.000Z',
    },
  ],
  auditLog: [
    {
      id: 3,
      action: 'deleted',
      entryId: 12,
      workArea: { id: 1, name: 'Vitrine 1' },
      description: 'Herrenuhr Automatik',
      code: '4000000000017',
      oldValue: '1',
      newValue: null,
      source: 'station',
      workstation: { id: 2, name: 'Kasse' },
      employees: ['Anna'],
      createdAt: '2026-01-02T09:05:00.000Z',
    },
  ],
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
  return realtime;
}

function stubSearch(extra: (url: string) => { body: unknown } | undefined = () => undefined) {
  return stubApi(({ url }) => {
    if (url === '/api/admin/stocktakes/active') return { body: { stocktake } };
    if (url === '/api/admin/stocktakes/1') return { body: stocktake };
    if (url === '/api/admin/stocktakes/1/articles/search?q=herrenuhr') {
      return {
        body: {
          articles: [{ ...watch, matchedBy: 'description' }],
          manualEntries: [
            {
              ...detail.entries[0]!,
              id: 20,
              articleId: null,
              isManual: true,
              description: 'Herrenuhr Unikat',
              code: '999',
              serialNumber: null,
              matchedBy: 'description',
            },
          ],
          hasMore: false,
        },
      };
    }
    if (url === '/api/admin/stocktakes/1/articles/5') return { body: detail };
    return extra(url);
  });
}

describe('article search', () => {
  it('searches and shows where an article was captured and what changed', async () => {
    const api = stubSearch();
    renderAdmin('/admin/artikel');
    fireEvent.change(
      await screen.findByLabelText('EAN, Artikelnummer, Bezeichnung oder Seriennummer'),
      { target: { value: 'herrenuhr' } },
    );

    const row = (await screen.findByRole('button', { name: 'Herrenuhr Automatik' })).closest('tr')!;
    expect(within(row).getByText('Bezeichnung')).toBeTruthy();
    expect(within(row).getByText('HU-100')).toBeTruthy();
    expect(screen.getByText('Herrenuhr Unikat')).toBeTruthy();
    expect(screen.getByText('Manuell erfasste Zeilen')).toBeTruthy();

    fireEvent.click(within(row).getByRole('button', { name: 'Herrenuhr Automatik' }));
    const heading = await screen.findByRole('heading', { name: 'Herrenuhr Automatik' });
    const card = heading.closest('.card') as HTMLElement;
    expect(within(card).getByText('SN-4711')).toBeTruthy();
    expect(within(card).getByText('-1')).toBeTruthy();
    expect(within(card).getByText('Zeile gelöscht')).toBeTruthy();
    expect(api.calls.some((c) => c.url === '/api/admin/stocktakes/1/articles/5')).toBe(true);
  });

  it('opens an article from a link', async () => {
    stubSearch();
    renderAdmin('/admin/artikel?artikel=5');
    expect(await screen.findByRole('heading', { name: 'Herrenuhr Automatik' })).toBeTruthy();
  });

  it('is linked from the target/actual comparison', async () => {
    const reconciliation: Reconciliation = {
      stocktakeId: 1,
      articleCount: 1,
      expectedQuantity: 2,
      withoutTargetCount: 0,
      shortage: {
        count: 1,
        quantity: 1,
        net: '1000.00',
        gross: '1190.00',
        byCategory: [
          { category: 'Uhren', count: 1, quantity: 1, net: '1000.00', gross: '1190.00' },
        ],
        articles: [
          {
            articleId: 5,
            description: 'Herrenuhr Automatik',
            ean: '4000000000017',
            category: 'Uhren',
            priceNet: '1000.00',
            priceGross: '1190.00',
            expected: 2,
            counted: 1,
            missing: 1,
            net: '1000.00',
            gross: '1190.00',
          },
        ],
        truncated: false,
      },
      surplus: { quantity: 0, net: '0.00', gross: '0.00', items: [] },
    };
    const statistics = {
      stocktakeId: 1,
      progress: { open: 0, in_progress: 0, closed: 0, total: 0 },
      totals: { lines: 0, quantity: 0, net: '0.00', gross: '0.00' },
      byWorkArea: [],
      byCategory: [],
      byEmployee: [],
      byWorkstation: [],
      rate: { bucketMinutes: 15, buckets: [] },
      manual: { lines: 0, quantity: 0, gross: '0.00', entries: [] },
      overcounted: [],
    } as unknown as StocktakeStatistics;
    stubSearch((url) => {
      if (url === '/api/admin/stocktakes/1/statistics') return { body: statistics };
      if (url === '/api/admin/stocktakes/1/reconciliation') return { body: reconciliation };
      return undefined;
    });
    renderAdmin('/admin/statistik');

    fireEvent.click(await screen.findByText(/Liste der Artikel mit Fehlmenge/));
    fireEvent.click(await screen.findByRole('link', { name: 'Herrenuhr Automatik' }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Herrenuhr Automatik' })).toBeTruthy(),
    );
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Artikelsuche');
  });
});
