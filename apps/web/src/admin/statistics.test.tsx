import type { Reconciliation, Stocktake, StocktakeStatistics } from '@inventur/shared';
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
  vi.useRealTimers();
});

const stocktake: Stocktake = {
  id: 1,
  name: 'Inventur 2026',
  status: 'active',
  startedAt: '2026-01-02T08:00:00.000Z',
  finishedAt: null,
};

function statistics(overrides: Partial<StocktakeStatistics> = {}): StocktakeStatistics {
  return {
    stocktakeId: 1,
    progress: { open: 1, in_progress: 1, closed: 2, total: 4 },
    totals: { lines: 12, quantity: 15, net: '1000.00', gross: '1234.50' },
    byWorkArea: [
      {
        id: 1,
        name: 'Vitrine 1',
        status: 'closed',
        lines: 12,
        quantity: 15,
        net: '1000.00',
        gross: '1234.50',
      },
    ],
    byCategory: [
      {
        category: 'Ringe',
        manual: false,
        lines: 10,
        quantity: 12,
        net: '1000.00',
        gross: '1190.00',
      },
      { category: null, manual: false, lines: 1, quantity: 1, net: '0.00', gross: '0.00' },
      { category: null, manual: true, lines: 1, quantity: 2, net: null, gross: '44.50' },
    ],
    byEmployee: [{ id: 1, name: 'Anna', lines: 12, quantity: 15 }],
    byWorkstation: [{ id: 1, name: 'Kasse', lines: 12, quantity: 15 }],
    rate: {
      bucketMinutes: 15,
      buckets: [
        { start: '2026-01-02T08:00:00.000Z', lines: 8, quantity: 10 },
        { start: '2026-01-02T08:15:00.000Z', lines: 4, quantity: 5 },
      ],
    },
    manual: {
      lines: 1,
      quantity: 2,
      gross: '44.50',
      entries: [
        {
          id: 9,
          workArea: { id: 1, name: 'Vitrine 1' },
          description: 'Brosche Unikat',
          input: '999',
          serialNumber: 'SN-1',
          quantity: 2,
          priceGross: '22.25',
          gross: '44.50',
          workstation: { id: 1, name: 'Kasse' },
          createdAt: '2026-01-02T08:20:00.000Z',
        },
      ],
    },
    duplicates: [
      {
        articleId: 5,
        description: 'Herrenuhr Doppelt',
        ean: '4000000000017',
        lines: 2,
        quantity: 2,
        workAreas: [{ id: 1, name: 'Vitrine 1' }],
      },
    ],
    ...overrides,
  };
}

const reconciliation: Reconciliation = {
  stocktakeId: 1,
  articleCount: 1000,
  shortage: {
    count: 988,
    net: '50000.00',
    gross: '59500.00',
    byCategory: [
      { category: 'Uhren', count: 900, net: '45000.00', gross: '53550.00' },
      { category: null, count: 88, net: '5000.00', gross: '5950.00' },
    ],
    articles: [
      {
        articleId: 7,
        description: 'Damenuhr Fehlend',
        ean: null,
        category: 'Uhren',
        priceNet: '100.00',
        priceGross: '119.00',
      },
    ],
    truncated: true,
  },
  surplus: {
    quantity: 3,
    net: '100.00',
    gross: '163.50',
    items: [
      {
        kind: 'excess',
        articleId: 5,
        entryId: null,
        description: 'Herrenuhr Doppelt',
        ean: '4000000000017',
        category: 'Uhren',
        priceNet: '100.00',
        priceGross: '119.00',
        expected: 1,
        counted: 2,
        surplus: 1,
        net: '100.00',
        gross: '119.00',
      },
      {
        kind: 'manual',
        articleId: null,
        entryId: 9,
        description: 'Brosche Unikat',
        ean: null,
        category: null,
        priceNet: null,
        priceGross: '22.25',
        expected: 0,
        counted: 2,
        surplus: 2,
        net: null,
        gross: '44.50',
      },
    ],
  },
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

function stubStatistics(stats: () => StocktakeStatistics) {
  return stubApi(({ url }) => {
    if (url === '/api/admin/stocktakes/active') return { body: { stocktake } };
    if (url === '/api/admin/stocktakes/1') return { body: stocktake };
    if (url === '/api/admin/stocktakes/1/statistics') return { body: stats() };
    if (url === '/api/admin/stocktakes/1/reconciliation') return { body: reconciliation };
    return undefined;
  });
}

const section = (title: string) => screen.getByRole('heading', { name: title }).parentElement!;

describe('statistics dashboard', () => {
  it('shows the key figures of the active stocktake', async () => {
    stubStatistics(() => statistics());
    renderAdmin('/admin/statistik');

    const overview = (await screen.findByRole('heading', { name: 'Überblick' })).parentElement!;
    expect(within(overview).getByText('2 / 4')).toBeTruthy();
    expect(within(overview).getByText('1.234,50 €')).toBeTruthy();
    expect(within(overview).getByRole('img').getAttribute('aria-label')).toBe(
      '2 abgeschlossen, 1 in Arbeit, 1 offen',
    );

    const categories = section('Je Kategorie');
    expect(within(categories).getByText('ohne Kategorie')).toBeTruthy();
    const manualRow = within(categories).getByText('ohne Kategorie (manuell)').closest('tr')!;
    expect(within(manualRow).getByText('–')).toBeTruthy();
    expect(within(manualRow).getByText('44,50 €')).toBeTruthy();

    expect(within(section('Erfassungsrate')).getByText('Stück je 15 Minuten')).toBeTruthy();
    expect(within(section('Erfassungsrate')).getByText('Anna')).toBeTruthy();
    expect(within(section('Manuell erfasste Artikel')).getByText('SN-1')).toBeTruthy();
    expect(within(section('Auffälligkeiten')).getByText('Herrenuhr Doppelt')).toBeTruthy();
  });

  it('shows the capture rate with a tooltip', async () => {
    stubStatistics(() => statistics());
    renderAdmin('/admin/statistik');
    const bar = await screen.findByLabelText(/: 5 Stück, 4 Zeilen$/);
    fireEvent.mouseEnter(bar);
    const tooltip = within(section('Erfassungsrate')).getByRole('status');
    expect(tooltip.textContent).toContain('5 Stück');
    expect(tooltip.textContent).toContain('4 Zeilen');
  });

  it('shows shortage and surplus of the target/actual comparison', async () => {
    stubStatistics(() => statistics());
    renderAdmin('/admin/statistik');
    const result = (await screen.findByRole('heading', { name: 'Soll/Ist-Abgleich' }))
      .parentElement!;
    expect(within(result).getByText('988')).toBeTruthy();
    expect(within(result).getByText('59.500,00 €')).toBeTruthy();
    expect(within(result).getByText(/die ersten 1 von 988/)).toBeTruthy();
    expect(within(result).getByText('Damenuhr Fehlend')).toBeTruthy();
    expect(within(result).getByText('mehrfach gezählt')).toBeTruthy();
    const manualRow = within(result).getByText('manuell erfasst').closest('tr')!;
    expect(within(manualRow).getByText('ohne Kategorie (manuell)')).toBeTruthy();
  });

  it('updates live, at most every two seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let lines = 12;
    const api = stubStatistics(() =>
      statistics({ totals: { lines, quantity: lines, net: '0.00', gross: '0.00' } }),
    );
    const realtime = renderAdmin('/admin/statistik');
    await screen.findByText('Überblick');
    const loads = () => api.calls.filter((c) => c.url.endsWith('/statistics')).length;
    expect(loads()).toBe(1);

    lines = 13;
    const event = {
      type: 'entry.changed',
      action: 'created',
      stocktakeId: 1,
      workAreaId: 1,
      entryId: 2,
    } as const;
    act(() => {
      realtime.latest().receive({ type: 'event', event });
      realtime.latest().receive({ type: 'event', event });
    });
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(loads()).toBe(1);
    await act(() => vi.advanceTimersByTimeAsync(1100));
    expect(loads()).toBe(2);
    expect(within(section('Überblick')).getAllByText('13')).toHaveLength(2);
  });

  it('shows the statistics of a stocktake from the history', async () => {
    stubStatistics(() => statistics());
    renderAdmin('/admin/historie/1');
    fireEvent.click(await screen.findByRole('link', { name: 'Statistik anzeigen' }));
    expect(await screen.findByText('Überblick')).toBeTruthy();
    expect(screen.getByRole('link', { name: '← Zurück zur Inventur' })).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'Statistik – Inventur 2026' })).toBeTruthy();
  });
});
