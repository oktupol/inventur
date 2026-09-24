import type { StationEmployee, StationState } from '@inventur/shared';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App.tsx';
import { RealtimeProvider } from '../realtime/RealtimeProvider.tsx';
import { stubApi } from '../test-utils/fake-api.ts';
import { createFakeRealtime } from '../test-utils/fake-realtime.ts';
import { loadToken, saveToken } from './token.ts';

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const kasse = { id: 7, name: 'Kasse' };
const stocktake = { id: 1, name: 'Inventur 2026' };

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

describe('workstation registration', () => {
  it('registers a new workstation and stores the token', async () => {
    const api = stubApi(({ method, url }) => {
      if (url === '/api/station/workstations') return { body: [] };
      if (method === 'POST' && url === '/api/station/register') {
        return { status: 201, body: { token: 'secret', workstation: kasse } };
      }
      if (url === '/api/station/pairings') return { body: [] };
      if (url === '/api/station/me') {
        return { body: { workstation: kasse, stocktake: null, employees: [], workArea: null } };
      }
    });
    renderStation();

    fireEvent.change(await screen.findByLabelText('Name der Station'), {
      target: { value: 'Kasse' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Registrieren' }));

    expect(await screen.findByText('Keine aktive Inventur')).toBeTruthy();
    expect(loadToken()).toBe('secret');
    const me = api.calls.find((c) => c.url === '/api/station/me');
    expect(me).toBeDefined();
    const fetchMock = vi.mocked(fetch);
    const meInit = fetchMock.mock.calls.find(([url]) => url === '/api/station/me')![1]!;
    expect(meInit.headers).toEqual({ 'x-workstation-token': 'secret' });
  });

  it('takes over an existing workstation', async () => {
    const api = stubApi(({ method, url }) => {
      if (url === '/api/station/workstations') return { body: [kasse] };
      if (method === 'POST' && url === '/api/station/take-over') {
        return { body: { token: 'new', workstation: kasse } };
      }
      if (url === '/api/station/pairings') return { body: [] };
      if (url === '/api/station/me') {
        return { body: { workstation: kasse, stocktake: null, employees: [], workArea: null } };
      }
    });
    renderStation();
    fireEvent.change(await screen.findByLabelText('Station'), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Übernehmen' }));
    expect(await screen.findByText('Keine aktive Inventur')).toBeTruthy();
    expect(api.writes()).toEqual([
      { method: 'POST', url: '/api/station/take-over', body: { workstationId: 7 } },
    ]);
    expect(loadToken()).toBe('new');
  });

  it('asks to register again when the token is no longer valid', async () => {
    saveToken('stale');
    stubApi(({ url }) => {
      if (url === '/api/station/pairings') return { body: [] };
      if (url === '/api/station/me') {
        return { status: 401, body: { error: 'x', code: 'workstation_unknown' } };
      }
      if (url === '/api/station/workstations') return { body: [kasse] };
    });
    renderStation();
    expect(await screen.findByText(/nicht mehr registriert/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Arbeitsstation einrichten' })).toBeTruthy();
    expect(loadToken()).toBeNull();
  });
});

describe('employees at the workstation', () => {
  it('offers only free employees and logs them in', async () => {
    saveToken('secret');
    let state: StationState = { workstation: kasse, stocktake, employees: [], workArea: null };
    const employees: StationEmployee[] = [
      { id: 1, name: 'Anna', workstation: null },
      { id: 2, name: 'Ben', workstation: { id: 8, name: 'Lager' } },
    ];
    const api = stubApi(({ method, url }) => {
      if (url === '/api/station/me') return { body: state };
      if (url === '/api/station/pairings') return { body: [] };
      if (url === '/api/station/employees') return { body: employees };
      if (url === '/api/station/work-areas') return { body: [] };
      if (method === 'POST' && url === '/api/station/employees/1/login') {
        state = { ...state, employees: [{ id: 1, name: 'Anna' }] };
        employees[0] = { ...employees[0]!, workstation: kasse };
        return { body: state };
      }
    });
    renderStation();

    expect(await screen.findByText(/Niemand angemeldet/)).toBeTruthy();
    const select = await screen.findByLabelText('Mitarbeiter anmelden');
    await waitFor(() => expect(within(select).queryByText('Anna')).toBeTruthy());
    // Ben is logged in to another workstation.
    expect(within(select).queryByText('Ben')).toBeNull();

    fireEvent.change(select, { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Anmelden' }));

    expect(await screen.findByRole('button', { name: 'Abmelden' })).toBeTruthy();
    expect(screen.queryByText(/Niemand angemeldet/)).toBeNull();
    expect(api.writes()).toEqual([
      { method: 'POST', url: '/api/station/employees/1/login', body: {} },
    ]);
  });

  it('shows why a busy employee cannot log in', async () => {
    saveToken('secret');
    stubApi(({ method, url }) => {
      if (url === '/api/station/pairings') return { body: [] };
      if (url === '/api/station/me') {
        return { body: { workstation: kasse, stocktake, employees: [], workArea: null } };
      }
      if (url === '/api/station/employees') {
        return { body: [{ id: 1, name: 'Anna', workstation: null }] };
      }
      if (url === '/api/station/work-areas') return { body: [] };
      if (method === 'POST') {
        return { status: 409, body: { error: 'x', code: 'employee_busy' } };
      }
    });
    renderStation();
    const select = await screen.findByLabelText('Mitarbeiter anmelden');
    await waitFor(() => expect(within(select).queryByText('Anna')).toBeTruthy());
    fireEvent.change(select, { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Anmelden' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/zuerst abmelden/);
  });
});
