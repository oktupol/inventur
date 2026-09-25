import type { MasterDataArticle, MasterDataOverview, Stocktake } from '@inventur/shared';
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

function article(id: number, description: string): MasterDataArticle {
  return {
    id,
    description,
    ean: '4006381333931',
    articleNumbers: ['R-1'],
    category: 'Uhren',
    priceNet: '100.00',
    priceGross: '119.00',
    expectedQuantity: 1,
  };
}

const overview: MasterDataOverview = {
  articleCount: 1500,
  withEan: 1400,
  withArticleNumber: 1200,
  withoutExpectedQuantity: 30,
  expected: { articles: 1470, quantity: 1600, net: '100000.00', gross: '119000.00' },
  byCategory: [
    {
      category: 'Uhren',
      articleCount: 1500,
      articles: 1470,
      quantity: 1600,
      net: '100000.00',
      gross: '119000.00',
    },
  ],
  checks: [
    {
      kind: 'duplicate_ean',
      count: 2,
      issues: [
        { article: article(1, 'Uhr A'), code: '4006381333931' },
        { article: article(2, 'Uhr B'), code: '4006381333931' },
      ],
      truncated: false,
    },
    { kind: 'duplicate_article_number', count: 0, issues: [], truncated: false },
    { kind: 'without_code', count: 0, issues: [], truncated: false },
    { kind: 'invalid_ean', count: 0, issues: [], truncated: false },
    { kind: 'zero_price', count: 0, issues: [], truncated: false },
    { kind: 'gross_below_net', count: 0, issues: [], truncated: false },
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
}

function stubMasterData() {
  return stubApi(({ url }) => {
    if (url === '/api/admin/stocktakes/active') return { body: { stocktake } };
    if (url === '/api/admin/master-data/overview') return { body: overview };
    const list = /^\/api\/admin\/master-data\/articles\?q=(.*)&offset=(\d+)$/.exec(url);
    if (list) {
      const offset = Number(list[2]);
      const q = decodeURIComponent(list[1]!);
      const total = q === '' ? 150 : 1;
      const count = Math.min(100, total - offset);
      return {
        body: {
          articles: Array.from({ length: count }, (_, i) =>
            article(offset + i + 1, q === '' ? `Artikel ${offset + i + 1}` : `Treffer ${q}`),
          ),
          offset,
          total,
          hasMore: false,
        },
      };
    }
    return undefined;
  });
}

describe('master data page', () => {
  it('shows key figures and checks', async () => {
    stubMasterData();
    renderAdmin('/admin/stammdaten');
    const overviewCard = (await screen.findByRole('heading', { name: 'Überblick' })).parentElement!;
    expect(within(overviewCard).getByText('1.500', { selector: '.value' })).toBeTruthy();
    expect(within(overviewCard).getByText('100 ohne')).toBeTruthy();

    const duplicates = screen.getByText('Doppelte EANs').closest('details')!;
    expect(duplicates.className).toContain('warning');
    expect(within(duplicates).getByText('Uhr A')).toBeTruthy();
    expect(within(duplicates).getAllByText('4006381333931').length).toBeGreaterThan(0);
    expect(screen.getByText('Preis 0 €').closest('details')!.className).toContain('ok');
  });

  it('reloads the overview on request', async () => {
    const api = stubMasterData();
    renderAdmin('/admin/stammdaten');
    await screen.findByRole('heading', { name: 'Überblick' });
    fireEvent.click(screen.getByRole('button', { name: 'Aktualisieren' }));
    await waitFor(() =>
      expect(api.calls.filter((c) => c.url === '/api/admin/master-data/overview')).toHaveLength(2),
    );
  });

  it('pages through and searches the articles', async () => {
    stubMasterData();
    renderAdmin('/admin/stammdaten');
    expect(await screen.findByText('1–100 von 150')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Weiter' }));
    expect(await screen.findByText('101–150 von 150')).toBeTruthy();
    expect(screen.getByText('Artikel 150')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Suche nach EAN, Artikelnummer oder Bezeichnung'), {
      target: { value: 'uhr' },
    });
    expect(await screen.findByText('Treffer uhr')).toBeTruthy();
    expect(screen.getByText('1–1 von 1')).toBeTruthy();
  });
});
