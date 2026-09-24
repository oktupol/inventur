import type { StationState, WorkArea } from '@inventur/shared';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App.tsx';
import { RealtimeProvider } from '../realtime/RealtimeProvider.tsx';
import { stubApi } from '../test-utils/fake-api.ts';
import { createFakeRealtime } from '../test-utils/fake-realtime.ts';
import { saveToken } from './token.ts';

beforeEach(() => {
  localStorage.clear();
  saveToken('secret');
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const kasse = { id: 7, name: 'Kasse' };

function area(id: number, name: string, status: WorkArea['status'], extra: Partial<WorkArea> = {}) {
  return {
    id,
    stocktakeId: 1,
    name,
    description: null,
    status,
    closedAt: null,
    entryCount: 0,
    quantity: 0,
    workstations: [],
    ...extra,
  } satisfies WorkArea;
}

/** A fake server with work areas that follow the state machine for this workstation. */
function stubServer(areas: WorkArea[]) {
  const state: StationState = {
    workstation: kasse,
    stocktake: { id: 1, name: 'Inventur' },
    employees: [{ id: 1, name: 'Anna' }],
    workArea: null,
  };
  const setArea = (a: WorkArea | undefined) => {
    state.workArea = a ? { id: a.id, name: a.name, status: a.status } : null;
  };
  const api = stubApi(({ method, url }) => {
    if (url === '/api/station/me') return { body: state };
    if (url === '/api/station/pairings') return { body: [] };
    if (url === '/api/station/employees') return { body: [] };
    if (url === '/api/station/work-areas') return { body: areas };
    const match = /^\/api\/station\/work-areas\/(\d+)\/(join|close|reopen)$/.exec(url);
    if (method === 'POST' && match) {
      const target = areas.find((a) => a.id === Number(match[1]))!;
      if (match[2] === 'join') {
        target.status = 'in_progress';
        target.workstations = [kasse];
        setArea(target);
      } else if (match[2] === 'close') {
        target.status = 'closed';
        target.workstations = [];
        setArea(undefined);
      } else {
        target.status = 'open';
      }
      return { body: state };
    }
    if (method === 'POST' && url === '/api/station/work-area/leave') {
      const current = areas.find((a) => a.id === state.workArea?.id)!;
      current.status = 'open';
      current.workstations = [];
      setArea(undefined);
      return { body: state };
    }
  });
  return { api, state, setArea };
}

function renderStation() {
  const realtime = createFakeRealtime();
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

const row = async (name: string) => (await screen.findByText(name)).closest('tr')!;

describe('work area selection at the workstation', () => {
  it('joins an open work area and leaves it again', async () => {
    const { api } = stubServer([area(1, 'Vitrine', 'open'), area(2, 'Lager', 'closed')]);
    renderStation();

    // Closed areas offer reopening instead of joining.
    expect(within(await row('Lager')).getByRole('button', { name: 'Wieder öffnen' })).toBeTruthy();

    fireEvent.click(within(await row('Vitrine')).getByRole('button', { name: 'Beitreten' }));
    const heading = await screen.findByRole('heading', { name: /Vitrine/ });
    expect(heading.textContent).toContain('in Arbeit');

    fireEvent.click(screen.getByRole('button', { name: 'Bereich verlassen' }));
    expect(await screen.findByRole('heading', { name: 'Arbeitsbereich wählen' })).toBeTruthy();
    // Leaving on purpose shows no notice about a closed area.
    expect(screen.queryByText(/wurde von einer anderen Station/)).toBeNull();
    expect(api.writes().map((c) => c.url)).toEqual([
      '/api/station/work-areas/1/join',
      '/api/station/work-area/leave',
    ]);
  });

  it('closes the work area after a safety question showing the quantity', async () => {
    const vitrine = area(1, 'Vitrine', 'in_progress', {
      entryCount: 12,
      quantity: 15,
      workstations: [kasse],
    });
    const server = stubServer([vitrine]);
    server.setArea(vitrine);
    renderStation();

    const close = await screen.findByRole<HTMLButtonElement>('button', { name: 'Abschließen' });
    await waitFor(() => expect(close.disabled).toBe(false));
    fireEvent.click(close);
    const dialog = screen.getByRole('dialog', { name: 'Arbeitsbereich abschließen' });
    expect(dialog.textContent).toContain('15 Stück in 12 Zeilen');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Abschließen' }));
    expect(await screen.findByRole('heading', { name: 'Arbeitsbereich wählen' })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(within(await row('Vitrine')).getByText('abgeschlossen')).toBeTruthy();
    expect(screen.queryByText(/wurde von einer anderen Station/)).toBeNull();
  });

  it('shows a notice when another workstation closes the area', async () => {
    const vitrine = area(1, 'Vitrine', 'in_progress', { workstations: [kasse] });
    const server = stubServer([vitrine]);
    server.setArea(vitrine);
    const realtime = renderStation();
    expect(await screen.findByRole('heading', { name: /Vitrine/ })).toBeTruthy();

    vitrine.status = 'closed';
    vitrine.workstations = [];
    server.setArea(undefined);
    act(() =>
      realtime.latest().receive({
        type: 'event',
        event: { type: 'workstation.changed', action: 'updated', workstationId: kasse.id },
      }),
    );

    expect(await screen.findByText(/„Vitrine“ wurde von einer anderen Station/)).toBeTruthy();
  });

  it('reopens a closed work area', async () => {
    const { api } = stubServer([area(2, 'Lager', 'closed')]);
    renderStation();
    fireEvent.click(within(await row('Lager')).getByRole('button', { name: 'Wieder öffnen' }));
    expect(
      await within(await row('Lager')).findByRole('button', { name: 'Beitreten' }),
    ).toBeTruthy();
    expect(api.writes().map((c) => c.url)).toEqual(['/api/station/work-areas/2/reopen']);
  });
});
