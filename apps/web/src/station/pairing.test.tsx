import type { PairingOffer, StationState } from '@inventur/shared';
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
});

const state: StationState = {
  workstation: { id: 7, name: 'Kasse' },
  stocktake: { id: 1, name: 'Inventur' },
  employees: [],
  workArea: null,
};

const offer: PairingOffer = {
  id: 55,
  code: '123456',
  scanUrl: 'https://192.168.1.10/scan',
  qrSvg: '<svg data-testid="qr"></svg>',
  certificateUrl: 'http://192.168.1.10/zertifikat',
  certificateQrSvg: '<svg></svg>',
  validUntil: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
};

function renderStation() {
  const api = stubApi(({ method, url }) => {
    if (url === '/api/station/me') return { body: state };
    if (url === '/api/station/employees' || url === '/api/station/work-areas') return { body: [] };
    if (method === 'GET' && url === '/api/station/pairings') return { body: [] };
    if (method === 'POST' && url === '/api/station/pairings') return { status: 201, body: offer };
    if (method === 'DELETE') return { status: 204 };
  });
  const realtime = createFakeRealtime();
  render(
    <RealtimeProvider client={realtime.client}>
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>
    </RealtimeProvider>,
  );
  act(() => realtime.latest().open());
  return { api, realtime };
}

describe('pairing a phone at the workstation', () => {
  it('shows the QR code, the code and the address, and confirms the pairing', async () => {
    const { realtime, api } = renderStation();
    fireEvent.click(await screen.findByRole('button', { name: 'Handy koppeln' }));
    const dialog = await screen.findByRole('dialog', { name: 'Handy koppeln' });
    expect((await within(dialog).findByLabelText('Kopplungscode')).textContent).toBe('123 456');
    expect(within(dialog).getByText('https://192.168.1.10/scan')).toBeTruthy();
    expect(dialog.querySelector('[data-testid="qr"]')).toBeTruthy();
    expect(
      within(dialog).getByText(/Gültig noch 5:00 Minuten|Gültig noch 4:5\d Minuten/),
    ).toBeTruthy();
    expect(within(dialog).getByText('http://192.168.1.10/zertifikat')).toBeTruthy();

    act(() =>
      realtime.latest().receive({
        type: 'event',
        event: { type: 'pairing.changed', action: 'created', workstationId: 7, pairingId: 55 },
      }),
    );
    expect(await within(dialog).findByText('Handy verbunden')).toBeTruthy();
    // A paired offer is not withdrawn when the dialog closes.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Schließen' }));
    expect(api.writes().filter((c) => c.method === 'DELETE')).toEqual([]);
  });

  it('withdraws the offer when the dialog is cancelled', async () => {
    const { api } = renderStation();
    fireEvent.click(await screen.findByRole('button', { name: 'Handy koppeln' }));
    const dialog = await screen.findByRole('dialog', { name: 'Handy koppeln' });
    await within(dialog).findByLabelText('Kopplungscode');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    await waitFor(() =>
      expect(api.writes().map((c) => [c.method, c.url])).toContainEqual([
        'DELETE',
        '/api/station/pairings/55',
      ]),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
