import type { ArticleMatch, Checkpoint, Entry, StationState } from '@inventur/shared';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App.tsx';
import { RealtimeProvider } from '../realtime/RealtimeProvider.tsx';
import { playTone } from '../station/audio.ts';
import { saveToken } from '../station/token.ts';
import { stubApi, type ApiCall } from '../test-utils/fake-api.ts';
import { createFakeRealtime } from '../test-utils/fake-realtime.ts';

vi.mock('../station/audio.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../station/audio.ts')>()),
  playTone: vi.fn(),
}));

beforeEach(() => {
  localStorage.clear();
  saveToken('secret');
  vi.mocked(playTone).mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const kasse = { id: 7, name: 'Kasse' };

function article(id: number, description: string, ean: string): ArticleMatch {
  return {
    id,
    description,
    ean,
    articleNumbers: [],
    category: 'Ringe',
    priceNet: '100.00',
    priceGross: '119.00',
    matchedBy: 'ean',
    matchedNumber: null,
  };
}

const ring = article(1, 'Herrenring Gold', '4000000000017');
const chainShort = article(2, 'Kette Silber', '4000000000031');
const chainLong = article(3, 'Kette Silber lang', '4000000000031');

/**
 * A fake server: `4000000000017` is unique, `4000000000031` ambiguous,
 * everything else unknown. `fail` makes the next entry requests fail.
 */
function stubServer(options: { employees?: boolean } = {}) {
  const state: StationState = {
    workstation: kasse,
    stocktake: { id: 1, name: 'Inventur' },
    employees: options.employees === false ? [] : [{ id: 1, name: 'Anna' }],
    workArea: { id: 4, name: 'Vitrine', status: 'in_progress' },
  };
  const entries: Entry[] = [];
  const checkpoints: Checkpoint[] = [];
  const control = { failures: 0 };
  let nextId = 1;

  function createEntry(a: ArticleMatch, input: string): Entry {
    const entry: Entry = {
      id: nextId++,
      workAreaId: 4,
      articleId: a.id,
      isManual: false,
      input,
      description: a.description,
      ean: a.ean,
      category: a.category,
      priceNet: a.priceNet,
      priceGross: a.priceGross,
      serialNumber: null,
      quantity: 1,
      workstation: kasse,
      createdAt: new Date(2026, 0, 1, 10, 0, entries.length).toISOString(),
      updatedAt: new Date().toISOString(),
      duplicateCount: entries.filter((e) => e.articleId === a.id).length,
      checkpointNumber: null,
    };
    entries.unshift(entry);
    return entry;
  }

  const api = stubApi((call: ApiCall) => {
    const { method, url, body } = call;
    if (url === '/api/station/me') return { body: state };
    if (url === '/api/station/employees') return { body: [] };
    if (url === '/api/station/work-areas') return { body: [] };
    if (method === 'GET' && url === '/api/station/entries') {
      return {
        body: {
          workArea: state.workArea,
          entries,
          checkpoints: [...checkpoints].reverse(),
          sinceLastCheckpoint: entries
            .filter((e) => e.checkpointNumber === null)
            .reduce((sum, e) => sum + e.quantity, 0),
          totals: {
            quantity: entries.length,
            lines: entries.length,
            grossValue: String(119 * entries.length),
          },
        },
      };
    }
    if (url.startsWith('/api/station/articles/search')) {
      const q = decodeURIComponent(url.split('q=')[1]!);
      return {
        body: {
          articles: q.toLowerCase().startsWith('herr')
            ? [{ ...ring, matchedBy: 'description' }]
            : q.startsWith('4000000000')
              ? [ring]
              : [],
          exact: false,
          hasMore: false,
        },
      };
    }
    if (method === 'POST' && url === '/api/station/checkpoints') {
      const number = checkpoints.length + 1;
      const open = entries.filter((e) => e.checkpointNumber === null);
      const sinceLast = open.reduce((sum, e) => sum + e.quantity, 0);
      for (const e of open) e.checkpointNumber = number;
      const checkpoint: Checkpoint = {
        id: 100 + number,
        workAreaId: 4,
        number,
        workstation: kasse,
        createdAt: new Date(2026, 0, 1, 11, 0, number).toISOString(),
        sinceLast,
        sinceStart: entries.reduce((sum, e) => sum + e.quantity, 0),
      };
      checkpoints.push(checkpoint);
      return { status: 201, body: checkpoint };
    }
    const row = /^\/api\/station\/entries\/(\d+)$/.exec(url);
    if (row) {
      const index = entries.findIndex((e) => e.id === Number(row[1]));
      if (index === -1) return { status: 404, body: { error: 'x', code: 'not_found' } };
      if (method === 'DELETE') {
        entries.splice(index, 1);
        return { status: 204 };
      }
      const change = body as { quantity?: number; delta?: number };
      const current = entries[index]!;
      current.quantity = change.quantity ?? Math.max(1, current.quantity + (change.delta ?? 0));
      return { body: current };
    }
    if (method === 'POST' && url === '/api/station/entries/manual') {
      const request = body as {
        input: string;
        description: string;
        priceGross: string;
        serialNumber: string | null;
      };
      const entry: Entry = {
        ...createEntry(ring, request.input),
        articleId: null,
        isManual: true,
        description: request.description,
        ean: null,
        category: null,
        priceNet: null,
        priceGross: request.priceGross,
        serialNumber: request.serialNumber,
        duplicateCount: 0,
      };
      entries[0] = entry;
      return { status: 201, body: entry };
    }
    if (method === 'POST' && url === '/api/station/entries') {
      if (control.failures > 0) {
        control.failures--;
        return { status: 503, body: 'unavailable' };
      }
      const { input, articleId } = body as { input: string; articleId?: number };
      const chosen = [ring, chainShort, chainLong].find((a) => a.id === articleId);
      if (chosen) return { body: { result: 'unique', entry: createEntry(chosen, input) } };
      if (input === ring.ean)
        return { body: { result: 'unique', entry: createEntry(ring, input) } };
      if (input === chainShort.ean) {
        return { body: { result: 'ambiguous', articles: [chainShort, chainLong], hasMore: false } };
      }
      return { body: { result: 'not_found' } };
    }
  });
  return {
    api,
    entries,
    control,
    entryPosts: () => api.calls.filter((c) => c.method === 'POST'),
    rowCalls: () =>
      api.calls
        .filter((c) => c.method === 'PATCH' || c.method === 'DELETE')
        .map((c) => ({ method: c.method, url: c.url, body: c.body })),
  };
}

function renderStation(options: { reconnectDelayMs?: () => number } = {}) {
  const realtime = createFakeRealtime(options);
  render(
    <RealtimeProvider client={realtime.client}>
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>
    </RealtimeProvider>,
  );
  act(() => realtime.latest().open());
  return realtime;
}

const input = () => screen.findByRole<HTMLInputElement>('textbox', { name: /Eingabe: EAN/ });

async function scan(code: string) {
  const field = await input();
  fireEvent.change(field, { target: { value: code } });
  fireEvent.keyDown(field, { key: 'Enter' });
}

const panel = () => document.querySelector('.capture-panel')!;

describe('capture', () => {
  it('captures a unique article: green, listed and counted', async () => {
    const server = stubServer();
    renderStation();
    const field = await input();
    await waitFor(() => expect(document.activeElement).toBe(field));

    await scan('4000000000017');
    await waitFor(() => expect(panel().getAttribute('data-feedback')).toBe('unique'));
    expect(field.value).toBe('');
    await waitFor(() =>
      expect(document.querySelector('table.entries')?.textContent).toContain('Herrenring Gold'),
    );
    expect(screen.getByLabelText('Summe im Bereich').textContent).toContain('1 Stück');

    const [post] = server.entryPosts();
    expect(post!.body).toMatchObject({ input: '4000000000017' });
    expect((post!.body as { requestId: string }).requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('hints at a single item captured again', async () => {
    stubServer();
    renderStation();
    await scan('4000000000017');
    await waitFor(() => expect(panel().getAttribute('data-feedback')).toBe('unique'));
    await scan('4000000000017');
    expect(await screen.findByText(/wurde bereits einmal erfasst/)).toBeTruthy();
    expect((await screen.findAllByText('mehrfach erfasst')).length).toBeGreaterThan(0);
  });

  it('lets the user choose between several articles with arrow keys and Enter', async () => {
    const server = stubServer();
    renderStation();
    await scan('4000000000031');
    const choices = await screen.findByRole('listbox', { name: 'Artikelauswahl' });
    expect(panel().getAttribute('data-feedback')).toBe('ambiguous');
    const field = await input();
    fireEvent.keyDown(field, { key: 'ArrowDown' });
    expect(within(choices).getAllByRole('option')[1]!.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(field, { key: 'Enter' });

    await waitFor(() => expect(panel().getAttribute('data-feedback')).toBe('unique'));
    expect(server.entryPosts().map((c) => (c.body as { articleId?: number }).articleId)).toEqual([
      undefined,
      3,
    ]);
  });

  it('cancels the choice with Esc without capturing', async () => {
    const server = stubServer();
    renderStation();
    await scan('4000000000031');
    await screen.findByRole('listbox', { name: 'Artikelauswahl' });
    fireEvent.keyDown(await input(), { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('listbox', { name: 'Artikelauswahl' })).toBeNull(),
    );
    expect(panel().getAttribute('data-feedback')).toBe('none');
    expect(server.entryPosts()).toHaveLength(1);
  });

  it('turns red and plays a tone for unknown articles until the next input', async () => {
    stubServer();
    renderStation();
    await scan('4099999999999');
    await waitFor(() => expect(panel().getAttribute('data-feedback')).toBe('not_found'));
    expect(screen.getByText(/Kein Artikel gefunden/)).toBeTruthy();
    expect(playTone).toHaveBeenCalledTimes(1);

    fireEvent.change(await input(), { target: { value: '4' } });
    expect(panel().getAttribute('data-feedback')).toBe('none');
  });

  it('processes 20 quick scans completely and in order', async () => {
    const server = stubServer();
    renderStation();
    const field = await input();
    for (let i = 0; i < 20; i++) {
      fireEvent.change(field, { target: { value: i % 2 ? '4000000000017' : `99${i}` } });
      fireEvent.keyDown(field, { key: 'Enter' });
    }
    await waitFor(() => expect(server.entryPosts()).toHaveLength(20));
    expect(server.entryPosts().map((c) => (c.body as { input: string }).input)).toEqual(
      Array.from({ length: 20 }, (_, i) => (i % 2 ? '4000000000017' : `99${i}`)),
    );
    await waitFor(() => expect(server.entries).toHaveLength(10));
  });

  it('queues scans behind an open choice', async () => {
    const server = stubServer();
    renderStation();
    await scan('4000000000031');
    await screen.findByRole('listbox', { name: 'Artikelauswahl' });
    await scan('4000000000017');
    expect(server.entryPosts()).toHaveLength(1);
    fireEvent.keyDown(await input(), { key: 'Enter' });
    await waitFor(() => expect(server.entryPosts()).toHaveLength(3));
    expect(server.entries.map((e) => e.articleId)).toEqual([1, 2]);
  });

  it('locks the input without connection and retries pending scans afterwards', async () => {
    const server = stubServer();
    server.control.failures = 1;
    const realtime = renderStation({ reconnectDelayMs: () => 10 });
    await scan('4000000000017');
    await waitFor(() => expect(server.entryPosts()).toHaveLength(1));

    act(() => realtime.latest().drop());
    expect((await screen.findByRole('alert')).textContent).toMatch(/Keine Verbindung/);
    expect((await input()).disabled).toBe(true);

    await waitFor(() => expect(realtime.sockets.length).toBe(2));
    act(() => realtime.latest().open());
    await waitFor(() => expect(server.entries).toHaveLength(1));
    expect(server.entryPosts()).toHaveLength(2);
    expect(server.entryPosts()[1]!.body).toEqual(server.entryPosts()[0]!.body);
    expect((await input()).disabled).toBe(false);
  });

  it('requires a logged-in employee', async () => {
    stubServer({ employees: false });
    renderStation();
    expect((await screen.findByRole('alert')).textContent).toMatch(/mindestens ein Mitarbeiter/);
    expect((await input()).disabled).toBe(true);
  });

  it('shows suggestions and completes a single one with Tab', async () => {
    stubServer();
    renderStation();
    const field = await input();
    fireEvent.change(field, { target: { value: 'Herr' } });
    const suggestions = await screen.findByRole('listbox', { name: 'Vorschläge' });
    expect(within(suggestions).getAllByText('Herrenring Gold').length).toBeGreaterThan(0);
    expect(document.querySelector('.ghost')!.textContent).toBe('Herrenring Gold');
    fireEvent.keyDown(field, { key: 'Tab' });
    expect(field.value).toBe('Herrenring Gold');
  });

  it('captures a suggestion clicked with the mouse', async () => {
    const server = stubServer();
    renderStation();
    fireEvent.change(await input(), { target: { value: '4000000000' } });
    const suggestions = await screen.findByRole('listbox', { name: 'Vorschläge' });
    fireEvent.click(within(suggestions).getByRole('button'));
    await waitFor(() => expect(server.entries).toHaveLength(1));
    expect(server.entryPosts()[0]!.body).toMatchObject({ input: '4000000000', articleId: 1 });
  });
});

describe('changing lines', () => {
  const press = async (...keys: string[]) => {
    const field = await input();
    for (const key of keys) fireEvent.keyDown(field, { key });
  };

  async function scanned(count: number) {
    const server = stubServer();
    renderStation();
    for (let i = 0; i < count; i++) {
      await scan('4000000000017');
      await waitFor(() => expect(server.entries).toHaveLength(i + 1));
    }
    await waitFor(() =>
      expect(document.querySelectorAll('table.entries tbody tr')).toHaveLength(count),
    );
    return server;
  }

  const selectedRow = () => document.querySelector('table.entries tr.selected');

  it('applies + right after a scan to the new line', async () => {
    const server = stubServer();
    renderStation();
    await scan('4000000000017');
    await press('+');
    await waitFor(() => expect(server.rowCalls()).toHaveLength(1));
    expect(server.rowCalls()[0]).toEqual({
      method: 'PATCH',
      url: '/api/station/entries/1',
      body: { delta: 1 },
    });
    expect(await screen.findByText(/ist jetzt/)).toBeTruthy();
  });

  it('decrements with - and sets the quantity with = 20 Enter and * 3 Enter', async () => {
    const server = await scanned(1);
    await press('-');
    await press('=');
    expect(screen.getByText('Menge:')).toBeTruthy();
    await press('2', '0', 'Enter');
    await press('*', '3', 'Enter');
    await waitFor(() => expect(server.rowCalls()).toHaveLength(3));
    expect(server.rowCalls().map((c) => c.body)).toEqual([
      { delta: -1 },
      { quantity: 20 },
      { quantity: 3 },
    ]);
    expect(screen.queryByText('Menge:')).toBeNull();
  });

  it('requires a quantity of at least 1 and cancels the quantity mode with Esc', async () => {
    const server = await scanned(1);
    await press('=', '0', 'Enter');
    expect(await screen.findByText('Die Menge muss mindestens 1 sein.')).toBeTruthy();
    expect(screen.getByText('Menge:')).toBeTruthy();
    await press('Escape');
    expect(screen.queryByText('Menge:')).toBeNull();
    expect(server.rowCalls()).toEqual([]);
  });

  it('types "AB-123" as input instead of treating - as a shortcut', async () => {
    const server = await scanned(1);
    const field = await input();
    let value = '';
    for (const char of 'AB-123') {
      fireEvent.keyDown(field, { key: char });
      value += char;
      fireEvent.change(field, { target: { value } });
    }
    expect(field.value).toBe('AB-123');
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => expect(server.entryPosts()).toHaveLength(2));
    expect(server.entryPosts()[1]!.body).toMatchObject({ input: 'AB-123' });
    expect(server.rowCalls()).toEqual([]);
  });

  it('selects another line with the arrow keys, deletes it with Delete and resets with Esc', async () => {
    const server = await scanned(3);
    // The newest own line is selected by default.
    expect(selectedRow()?.getAttribute('data-entry-id')).toBe('3');
    await press('ArrowDown', 'ArrowDown');
    expect(selectedRow()?.getAttribute('data-entry-id')).toBe('1');
    await press('Escape');
    expect(selectedRow()?.getAttribute('data-entry-id')).toBe('3');
    await press('ArrowDown', 'Delete');
    await waitFor(() => expect(server.rowCalls()).toHaveLength(1));
    expect(server.rowCalls()[0]).toMatchObject({
      method: 'DELETE',
      url: '/api/station/entries/2',
    });
    expect(await screen.findByText('Zeile gelöscht:')).toBeTruthy();
    await waitFor(() =>
      expect(document.querySelectorAll('table.entries tbody tr')).toHaveLength(2),
    );
  });

  it('offers +, −, an editable quantity and Löschen per line for the mouse', async () => {
    const server = await scanned(1);
    const row = document.querySelector('table.entries tbody tr') as HTMLElement;
    const minus = within(row).getByRole<HTMLButtonElement>('button', { name: 'Menge verringern' });
    expect(minus.disabled).toBe(true);

    fireEvent.click(within(row).getByRole('button', { name: 'Menge erhöhen' }));
    await waitFor(() => expect(server.rowCalls()).toHaveLength(1));

    const quantity = within(row).getByRole<HTMLInputElement>('spinbutton', { name: 'Menge' });
    fireEvent.focus(quantity);
    fireEvent.change(quantity, { target: { value: '12' } });
    fireEvent.keyDown(quantity, { key: 'Enter' });
    await waitFor(() => expect(server.rowCalls()).toHaveLength(2));

    fireEvent.click(within(row).getByRole('button', { name: 'Löschen' }));
    await waitFor(() => expect(server.rowCalls()).toHaveLength(3));
    expect(server.rowCalls().map((c) => [c.method, c.body])).toEqual([
      ['PATCH', { delta: 1 }],
      ['PATCH', { quantity: 12 }],
      ['DELETE', undefined],
    ]);
  });

  it('reports a line that another workstation deleted', async () => {
    const server = await scanned(1);
    server.entries.splice(0, 1);
    await press('+');
    expect(await screen.findByText('Die Zeile gibt es nicht mehr.')).toBeTruthy();
  });
});

describe('manual capture', () => {
  const dialog = () => screen.findByRole('dialog', { name: 'Manuell erfassen' });

  async function fill(description: string, price: string, serialNumber = '') {
    const form = await dialog();
    fireEvent.change(within(form).getByLabelText('Bezeichnung'), {
      target: { value: description },
    });
    fireEvent.change(within(form).getByLabelText('Bruttopreis in €'), { target: { value: price } });
    if (serialNumber) {
      fireEvent.change(within(form).getByLabelText('Seriennummer (optional)'), {
        target: { value: serialNumber },
      });
    }
    fireEvent.submit(form.querySelector('form')!);
  }

  const manualPosts = (server: ReturnType<typeof stubServer>) =>
    server.api.calls.filter((c) => c.url === '/api/station/entries/manual');

  it('captures an unknown scan with F2 in a few keystrokes and marks it in the list', async () => {
    const server = stubServer();
    renderStation();
    await scan('4099999999994');
    await waitFor(() => expect(panel().getAttribute('data-feedback')).toBe('not_found'));

    fireEvent.keyDown(await input(), { key: 'F2' });
    const form = await dialog();
    expect(form.textContent).toContain('4099999999994');
    // The description field has the focus right away.
    expect(document.activeElement).toBe(within(form).getByLabelText('Bezeichnung'));
    await fill('Ring Silber', '129,90', 'SN-7');

    await waitFor(() => expect(manualPosts(server)).toHaveLength(1));
    expect(manualPosts(server)[0]!.body).toMatchObject({
      input: '4099999999994',
      description: 'Ring Silber',
      priceGross: '129.90',
      serialNumber: 'SN-7',
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(panel().getAttribute('data-feedback')).toBe('unique'));
    expect(screen.getByText(/manuell erfasst/)).toBeTruthy();
    await waitFor(() =>
      expect(document.querySelector('table.entries .badge.manual')?.textContent).toBe('manuell'),
    );
  });

  it('opens from the button next to the red notice', async () => {
    stubServer();
    renderStation();
    await scan('4099999999994');
    const notice = await screen.findByText(/Kein Artikel gefunden/);
    fireEvent.click(
      within(notice.parentElement!).getByRole('button', { name: /Manuell erfassen/ }),
    );
    expect((await dialog()).textContent).toContain('4099999999994');
  });

  it('works without a previous scan and is cancelled with Esc', async () => {
    const server = stubServer();
    renderStation();
    fireEvent.keyDown(await input(), { key: 'F2' });
    expect((await dialog()).textContent).not.toContain('Eingabe:');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: /Manuell erfassen/ }));
    await fill('Armband', '20');
    await waitFor(() => expect(manualPosts(server)).toHaveLength(1));
    expect(manualPosts(server)[0]!.body).toMatchObject({ input: '', serialNumber: null });
  });

  it('requires a description and a positive price', async () => {
    const server = stubServer();
    renderStation();
    fireEvent.keyDown(await input(), { key: 'F2' });
    await fill('', '10');
    expect((await screen.findByRole('alert')).textContent).toMatch(/Bezeichnung/);
    await fill('Ring', '0');
    expect((await screen.findByRole('alert')).textContent).toMatch(/größer als 0/);
    expect(manualPosts(server)).toEqual([]);
    expect(await dialog()).toBeTruthy();
  });
});

describe('checkpoints', () => {
  it('sets a checkpoint with F3 and shows it as a separator with counts', async () => {
    const server = stubServer();
    renderStation();
    await scan('4000000000017');
    await waitFor(() => expect(server.entries).toHaveLength(1));
    await scan('4000000000017');
    await waitFor(() => expect(server.entries).toHaveLength(2));

    fireEvent.keyDown(await input(), { key: 'F3' });
    expect(await screen.findByText('Checkpoint 1 gesetzt:')).toBeTruthy();
    const separator = await waitFor(() => {
      const row = document.querySelector('table.entries tr.checkpoint-row');
      expect(row).toBeTruthy();
      return row!;
    });
    expect(separator.textContent).toContain('2 Stück seit Beginn');

    await scan('4000000000017');
    await waitFor(() =>
      expect(document.querySelector('.since-checkpoint-row')?.textContent).toBe(
        'Seit Checkpoint 1: 1 Stück',
      ),
    );
    expect(screen.getByLabelText('Summe im Bereich').textContent).toContain(
      'seit Checkpoint 1: 1 Stück',
    );
    // The new line is above the separator, the older ones below it.
    const rows = [...document.querySelectorAll('table.entries tbody tr')].map((r) => r.className);
    expect(rows).toEqual(['selected', 'since-checkpoint-row', 'checkpoint-row', '', '']);
  });

  it('sets a checkpoint with the button', async () => {
    const server = stubServer();
    renderStation();
    fireEvent.click(await screen.findByRole('button', { name: /Checkpoint/ }));
    await waitFor(() =>
      expect(server.api.calls.some((c) => c.url === '/api/station/checkpoints')).toBe(true),
    );
  });

  it('does not treat F3 as a shortcut while typing', async () => {
    const server = stubServer();
    renderStation();
    fireEvent.change(await input(), { target: { value: '40' } });
    fireEvent.keyDown(await input(), { key: 'F3' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(server.api.calls.some((c) => c.url === '/api/station/checkpoints')).toBe(false);
  });
});
