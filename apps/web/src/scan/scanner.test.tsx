import type { ArticleMatch, Entry, StationState } from '@inventur/shared';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App.tsx';
import { RealtimeProvider } from '../realtime/RealtimeProvider.tsx';
import { stubApi } from '../test-utils/fake-api.ts';
import { createFakeRealtime } from '../test-utils/fake-realtime.ts';
import { CameraError, startCamera } from './camera.ts';
import { saveDeviceToken } from './deviceToken.ts';
import { signal } from './signal.ts';

vi.mock('./camera.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./camera.ts')>()),
  startCamera: vi.fn(),
}));
vi.mock('./signal.ts', () => ({ signal: vi.fn() }));

const stop = vi.fn();
let detect: (code: string) => void = () => {};

beforeEach(() => {
  localStorage.clear();
  stop.mockClear();
  saveDeviceToken('device');
  vi.mocked(signal).mockClear();
  vi.mocked(startCamera).mockReset();
  vi.mocked(startCamera).mockImplementation(async (_video, onCode) => {
    detect = onCode;
    return { engine: 'native', stop };
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const state: StationState = {
  workstation: { id: 7, name: 'Kasse' },
  stocktake: { id: 1, name: 'Inventur' },
  employees: [{ id: 1, name: 'Anna' }],
  workArea: { id: 4, name: 'Vitrine', status: 'in_progress' },
};

function article(id: number, description: string): ArticleMatch {
  return {
    id,
    description,
    ean: '4000000000031',
    articleNumbers: [],
    category: 'Ketten',
    priceNet: '10.00',
    priceGross: '11.90',
    matchedBy: 'ean',
    matchedNumber: null,
  };
}

function entry(id: number, description: string, quantity = 1): Entry {
  return {
    id,
    workAreaId: 4,
    articleId: 1,
    isManual: false,
    input: '4000000000017',
    description,
    ean: '4000000000017',
    category: 'Ringe',
    priceNet: '100.00',
    priceGross: '119.00',
    serialNumber: null,
    quantity,
    workstation: state.workstation,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    duplicateCount: 0,
    checkpointNumber: null,
  };
}

function renderScanner() {
  let quantity = 1;
  const api = stubApi(({ method, url, body }) => {
    if (url === '/api/scan/me') return { body: state };
    if (method === 'POST' && url === '/api/scan/entries') {
      const { input, articleId } = body as { input: string; articleId?: number };
      if (articleId === 3) return { body: { result: 'unique', entry: entry(9, 'Kette lang') } };
      if (input === '4000000000017') {
        return { body: { result: 'unique', entry: entry(8, 'Herrenring Gold') } };
      }
      if (input === '4000000000031') {
        return {
          body: {
            result: 'ambiguous',
            articles: [article(2, 'Kette'), article(3, 'Kette lang')],
            hasMore: false,
          },
        };
      }
      return { body: { result: 'not_found' } };
    }
    if (method === 'PATCH' && url === '/api/scan/entries/8') {
      quantity = Math.max(1, quantity + (body as { delta: number }).delta);
      return { body: entry(8, 'Herrenring Gold', quantity) };
    }
    if (method === 'DELETE' && url === '/api/scan/entries/8') {
      return { body: { removedCheckpoints: [] } };
    }
  });
  const realtime = createFakeRealtime();
  render(
    <RealtimeProvider client={realtime.client}>
      <MemoryRouter initialEntries={['/scan']}>
        <App />
      </MemoryRouter>
    </RealtimeProvider>,
  );
  act(() => realtime.latest().open());
  return { api, entryPosts: () => api.calls.filter((c) => c.url === '/api/scan/entries') };
}

async function startScanning() {
  fireEvent.click(await screen.findByRole('button', { name: 'Kamera starten' }));
  await screen.findByRole('button', { name: 'Kamera ausschalten' });
}

const result = () => document.querySelector('[data-result]');

describe('phone scanner', () => {
  it('captures a detected code once and changes its line with +, − and Löschen', async () => {
    const { api, entryPosts } = renderScanner();
    await startScanning();
    act(() => {
      detect('4000000000017');
      detect('4000000000017');
      detect('4000000000017');
    });
    await waitFor(() => expect(result()?.getAttribute('data-result')).toBe('unique'));
    expect(entryPosts()).toHaveLength(1);
    expect(signal).toHaveBeenCalledWith('unique');
    const card = result() as HTMLElement;
    expect(card.textContent).toContain('Herrenring Gold');
    expect(card.textContent).toContain('119,00');

    fireEvent.click(within(card).getByRole('button', { name: 'Menge erhöhen' }));
    await waitFor(() => expect(within(card).getByLabelText('Menge').textContent).toBe('2'));
    fireEvent.click(within(card).getByRole('button', { name: 'Menge verringern' }));
    await waitFor(() => expect(within(card).getByLabelText('Menge').textContent).toBe('1'));
    fireEvent.click(within(card).getByRole('button', { name: 'Löschen' }));
    await waitFor(() => expect(result()?.textContent).toBe('Zeile gelöscht: Herrenring Gold'));

    expect(
      api.calls
        .filter((c) => c.url.startsWith('/api/scan/entries/'))
        .map((c) => [c.method, c.url, c.body]),
    ).toEqual([
      ['PATCH', '/api/scan/entries/8', { delta: 1 }],
      ['PATCH', '/api/scan/entries/8', { delta: -1 }],
      ['DELETE', '/api/scan/entries/8', undefined],
    ]);
  });

  it('lets the user choose between several articles', async () => {
    const { entryPosts } = renderScanner();
    await startScanning();
    act(() => detect('4000000000031'));
    const choices = await screen.findByRole('list', { name: 'Artikelauswahl' });
    expect(signal).toHaveBeenCalledWith('ambiguous');
    fireEvent.click(within(choices).getByText('Kette lang'));
    await waitFor(() => expect(result()?.textContent).toContain('Kette lang'));
    expect(entryPosts()[1]!.body).toMatchObject({ input: '4000000000031', articleId: 3 });
  });

  it('asks to capture unknown articles manually at the workstation', async () => {
    renderScanner();
    await startScanning();
    act(() => detect('4099999999994'));
    await waitFor(() => expect(result()?.getAttribute('data-result')).toBe('not_found'));
    expect(result()?.textContent).toContain('Artikel unbekannt');
    expect(result()?.textContent).toContain('Bitte an der Station manuell erfassen.');
    expect(signal).toHaveBeenCalledWith('not_found');
  });

  it('accepts a code typed on the phone', async () => {
    const { entryPosts } = renderScanner();
    fireEvent.click(await screen.findByRole('button', { name: 'Code eintippen' }));
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: '4000000000017' } });
    fireEvent.click(screen.getByRole('button', { name: 'Erfassen' }));
    await waitFor(() => expect(result()?.getAttribute('data-result')).toBe('unique'));
    expect(entryPosts()).toHaveLength(1);
  });

  it('explains camera errors', async () => {
    vi.mocked(startCamera).mockRejectedValue(new CameraError('Kamera verweigert'));
    renderScanner();
    fireEvent.click(await screen.findByRole('button', { name: 'Kamera starten' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Kamera verweigert');
  });

  it('stops the camera', async () => {
    renderScanner();
    await startScanning();
    fireEvent.click(screen.getByRole('button', { name: 'Kamera ausschalten' }));
    expect(stop).toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: 'Kamera starten' })).toBeTruthy();
  });

  it('closes a result to see the camera picture', async () => {
    renderScanner();
    await startScanning();
    act(() => detect('4099999999994'));
    await waitFor(() => expect(result()).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Ergebnis schließen' }));
    expect(result()).toBeNull();
  });
});

describe('hold mode', () => {
  const holdButton = () => screen.getByRole('button', { name: /Zum Scannen halten|Scannt/ });

  it('only scans while the button is held and remembers the mode', async () => {
    const { entryPosts } = renderScanner();
    await startScanning();
    fireEvent.click(screen.getByRole('button', { name: 'Modus: Auto' }));
    expect(localStorage.getItem('inventur.scanHoldMode')).toBe('true');

    act(() => detect('4000000000017'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(entryPosts()).toHaveLength(0);

    fireEvent.pointerDown(holdButton(), { pointerId: 1 });
    expect(holdButton().textContent).toBe('Scannt …');
    act(() => detect('4000000000017'));
    await waitFor(() => expect(entryPosts()).toHaveLength(1));
    fireEvent.pointerUp(holdButton(), { pointerId: 1 });

    act(() => detect('4000000000017'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(entryPosts()).toHaveLength(1);
  });

  it('reads the same code again on the next press', async () => {
    localStorage.setItem('inventur.scanHoldMode', 'true');
    const { entryPosts } = renderScanner();
    await startScanning();
    expect(screen.getByRole('button', { name: 'Modus: Taste' })).toBeTruthy();
    for (let press = 1; press <= 2; press++) {
      fireEvent.pointerDown(holdButton(), { pointerId: press });
      act(() => detect('4000000000017'));
      await waitFor(() => expect(entryPosts()).toHaveLength(press));
      fireEvent.pointerUp(holdButton(), { pointerId: press });
    }
  });
});
