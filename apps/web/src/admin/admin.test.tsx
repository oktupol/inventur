import type { Employee, Stocktake, WorkArea } from '@inventur/shared';
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

function workArea(id: number, name: string, status: WorkArea['status']): WorkArea {
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
  };
}

function employee(id: number, name: string, entryCount = 0): Employee {
  return { id, stocktakeId: 1, name, workstation: null, entryCount };
}

/** Clicks "Inventur beenden" once the work areas are loaded and the button is enabled. */
async function openFinishDialog() {
  const button = await screen.findByRole<HTMLButtonElement>('button', { name: 'Inventur beenden' });
  await waitFor(() => expect(button.disabled).toBe(false));
  fireEvent.click(button);
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

describe('stocktake page', () => {
  it('starts a stocktake when none is active', async () => {
    let active: Stocktake | null = null;
    const api = stubApi(({ method, url }) => {
      if (url === '/api/admin/stocktakes/active') return { body: { stocktake: active } };
      if (method === 'POST' && url === '/api/admin/stocktakes') {
        active = stocktake;
        return { status: 201, body: stocktake };
      }
      if (url.endsWith('/work-areas') || url.endsWith('/employees')) return { body: [] };
    });
    renderAdmin('/admin');

    const input = await screen.findByLabelText('Bezeichnung');
    fireEvent.change(input, { target: { value: 'Inventur 2026' } });
    fireEvent.click(screen.getByRole('button', { name: 'Inventur starten' }));

    expect(await screen.findByRole('button', { name: 'Inventur beenden' })).toBeTruthy();
    expect(api.writes()).toEqual([
      { method: 'POST', url: '/api/admin/stocktakes', body: { name: 'Inventur 2026' } },
    ]);
  });

  it('shows the German error when starting fails', async () => {
    stubApi(({ method, url }) => {
      if (url === '/api/admin/stocktakes/active') return { body: { stocktake: null } };
      if (method === 'POST') {
        return { status: 409, body: { error: 'x', code: 'stocktake_already_active' } };
      }
    });
    renderAdmin('/admin');
    fireEvent.click(await screen.findByRole('button', { name: 'Inventur starten' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Es läuft bereits eine Inventur. Sie muss zuerst beendet werden.',
    );
  });

  it('warns about unclosed work areas before finishing', async () => {
    let areas = [workArea(1, 'Vitrine 1', 'closed'), workArea(2, 'Lager', 'in_progress')];
    let finished = false;
    const api = stubApi(({ method, url, body }) => {
      if (url === '/api/admin/stocktakes/active') {
        return { body: { stocktake: finished ? null : stocktake } };
      }
      if (url.endsWith('/work-areas')) return { body: areas };
      if (url.endsWith('/employees')) return { body: [] };
      if (method === 'POST' && url.endsWith('/finish')) {
        // Another area was added after the page loaded.
        if (areas.length === 2) {
          areas = [...areas, workArea(3, 'Tresor', 'open')];
          return {
            status: 409,
            body: {
              error: 'x',
              code: 'unclosed_work_areas',
              details: {
                workAreas: [
                  { id: 2, name: 'Lager', status: 'in_progress' },
                  { id: 3, name: 'Tresor', status: 'open' },
                ],
              },
            },
          };
        }
        expect(body).toEqual({ confirm: true });
        finished = true;
        return { body: { ...stocktake, status: 'finished' } };
      }
    });
    renderAdmin('/admin');

    await openFinishDialog();
    const dialog = screen.getByRole('dialog', { name: 'Inventur beenden' });
    expect(within(dialog).getByRole('alert').textContent).toContain(
      'Ein Arbeitsbereich ist noch nicht abgeschlossen:Lager (in Arbeit)',
    );

    fireEvent.click(within(dialog).getByRole('button', { name: 'Trotzdem beenden' }));
    expect(await within(dialog).findByText('Tresor (offen)')).toBeTruthy();
    expect(within(dialog).getByRole('alert').textContent).toContain(
      '2 Arbeitsbereiche sind noch nicht abgeschlossen:',
    );

    fireEvent.click(within(dialog).getByRole('button', { name: 'Trotzdem beenden' }));
    expect(await screen.findByRole('button', { name: 'Inventur starten' })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.writes().map((c) => c.body)).toEqual([{ confirm: true }, { confirm: true }]);
  });

  it('closes the finish dialog on cancel without finishing', async () => {
    const api = stubApi(({ url }) => {
      if (url === '/api/admin/stocktakes/active') return { body: { stocktake } };
      if (url.endsWith('/work-areas') || url.endsWith('/employees')) return { body: [] };
    });
    renderAdmin('/admin');
    await openFinishDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.writes()).toEqual([]);
  });
});

describe('employees page', () => {
  it('shows a hint without an active stocktake', async () => {
    stubApi(({ url }) =>
      url === '/api/admin/stocktakes/active' ? { body: { stocktake: null } } : undefined,
    );
    renderAdmin('/admin/mitarbeiter');
    expect(await screen.findByText('Es läuft keine Inventur.')).toBeTruthy();
  });

  it('adds employees and updates live on realtime events', async () => {
    let employees = [employee(1, 'Anna', 3)];
    const api = stubApi(({ method, url, body }) => {
      if (url === '/api/admin/stocktakes/active') return { body: { stocktake } };
      if (method === 'GET' && url === '/api/admin/stocktakes/1/employees') {
        return { body: employees };
      }
      if (method === 'POST' && url === '/api/admin/stocktakes/1/employees') {
        const created = employee(2, (body as { name: string }).name);
        employees = [...employees, created];
        return { status: 201, body: created };
      }
    });
    const realtime = renderAdmin('/admin/mitarbeiter');

    const anna = (await screen.findByText('Anna')).closest('tr')!;
    // Employees with entries cannot be removed.
    expect(
      within(anna).getByRole<HTMLButtonElement>('button', { name: 'Entfernen' }).disabled,
    ).toBe(true);

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ben' } });
    fireEvent.click(screen.getByRole('button', { name: 'Hinzufügen' }));
    expect(await screen.findByText('Ben')).toBeTruthy();
    expect(api.writes()).toEqual([
      { method: 'POST', url: '/api/admin/stocktakes/1/employees', body: { name: 'Ben' } },
    ]);

    // Another admin tab adds an employee.
    employees = [...employees, employee(3, 'Cem')];
    vi.useFakeTimers();
    try {
      act(() =>
        realtime.latest().receive({
          type: 'event',
          event: { type: 'employee.changed', action: 'created', stocktakeId: 1, employeeId: 3 },
        }),
      );
      await act(() => vi.advanceTimersByTimeAsync(100));
    } finally {
      vi.useRealTimers();
    }
    expect(await screen.findByText('Cem')).toBeTruthy();
  });

  it('removes an employee after confirmation', async () => {
    let employees = [employee(1, 'Anna')];
    const api = stubApi(({ method, url }) => {
      if (url === '/api/admin/stocktakes/active') return { body: { stocktake } };
      if (method === 'GET' && url.endsWith('/employees')) return { body: employees };
      if (method === 'DELETE') {
        employees = [];
        return { status: 204 };
      }
    });
    renderAdmin('/admin/mitarbeiter');
    fireEvent.click(await screen.findByRole('button', { name: 'Entfernen' }));
    const dialog = screen.getByRole('dialog', { name: 'Mitarbeiter entfernen' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Entfernen' }));
    expect(await screen.findByText('Noch keine Mitarbeiter.')).toBeTruthy();
    expect(api.writes()).toEqual([
      { method: 'DELETE', url: '/api/admin/stocktakes/1/employees/1', body: undefined },
    ]);
  });
});

describe('work areas page', () => {
  it('renames a work area and reports duplicate names', async () => {
    const api = stubApi(({ method, url }) => {
      if (url === '/api/admin/stocktakes/active') return { body: { stocktake } };
      if (method === 'GET' && url.endsWith('/work-areas')) {
        return { body: [workArea(1, 'Lager', 'open')] };
      }
      if (method === 'PATCH') return { status: 409, body: { error: 'x', code: 'name_taken' } };
    });
    renderAdmin('/admin/bereiche');
    fireEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    const dialog = screen.getByRole('dialog', { name: 'Arbeitsbereich bearbeiten' });
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Tresor' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      'Dieser Name ist bereits vergeben.',
    );
    expect(api.writes()).toEqual([
      {
        method: 'PATCH',
        url: '/api/admin/stocktakes/1/work-areas/1',
        body: { name: 'Tresor', description: '' },
      },
    ]);
  });
});

describe('closing work areas in the dashboard', () => {
  it('closes after confirming the quantity and reopens', async () => {
    const areas = [{ ...workArea(1, 'Vitrine', 'in_progress'), quantity: 42, entryCount: 40 }];
    const api = stubApi(({ method, url }) => {
      if (url === '/api/admin/stocktakes/active') return { body: { stocktake } };
      if (method === 'GET' && url.endsWith('/work-areas')) return { body: areas };
      if (method === 'POST' && url.endsWith('/close')) {
        areas[0] = { ...areas[0]!, status: 'closed' };
        return { status: 204 };
      }
      if (method === 'POST' && url.endsWith('/reopen')) {
        areas[0] = { ...areas[0]!, status: 'open' };
        return { status: 204 };
      }
    });
    renderAdmin('/admin/bereiche');
    fireEvent.click(await screen.findByRole('button', { name: 'Abschließen' }));
    const dialog = screen.getByRole('dialog', { name: 'Arbeitsbereich abschließen' });
    expect(dialog.textContent).toContain('42 Stück in 40 Zeilen');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Abschließen' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Wieder öffnen' }));
    expect(await screen.findByRole('button', { name: 'Abschließen' })).toBeTruthy();
    expect(api.writes().map((c) => c.url)).toEqual([
      '/api/admin/stocktakes/1/work-areas/1/close',
      '/api/admin/stocktakes/1/work-areas/1/reopen',
    ]);
  });
});
