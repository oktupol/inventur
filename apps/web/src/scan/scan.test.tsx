import type { StationState } from '@inventur/shared';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App.tsx';
import { RealtimeProvider } from '../realtime/RealtimeProvider.tsx';
import { stubApi } from '../test-utils/fake-api.ts';
import { createFakeRealtime } from '../test-utils/fake-realtime.ts';
import { loadDeviceToken, saveDeviceToken } from './deviceToken.ts';

beforeEach(() => localStorage.clear());
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

function renderScan(path = '/scan', options: { paired?: boolean } = {}) {
  let paired = options.paired ?? false;
  const api = stubApi(({ method, url, body }) => {
    if (method === 'POST' && url === '/api/scan/pair') {
      const request = body as { code?: string; qrToken?: string };
      if (request.code === '123456' || request.qrToken === 'qr-token') {
        paired = true;
        return { body: { deviceToken: 'device', workstation: state.workstation } };
      }
      return { status: 410, body: { error: 'x', code: 'pairing_expired' } };
    }
    if (url === '/api/scan/me') {
      return paired
        ? { body: state }
        : { status: 401, body: { error: 'x', code: 'device_unknown' } };
    }
    if (method === 'DELETE' && url === '/api/scan/pairing') {
      paired = false;
      return { status: 204 };
    }
  });
  const realtime = createFakeRealtime();
  render(
    <RealtimeProvider client={realtime.client}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </RealtimeProvider>,
  );
  act(() => realtime.latest().open());
  return {
    api,
    realtime,
    unpair: () => {
      paired = false;
    },
  };
}

describe('phone pairing', () => {
  it('pairs with the six-digit code and remembers it', async () => {
    const { api } = renderScan();
    fireEvent.change(await screen.findByLabelText('Code von der Station'), {
      target: { value: '123 456' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Koppeln' }));
    expect((await screen.findAllByText('Kasse', { selector: 'strong' })).length).toBeGreaterThan(0);
    expect(screen.getByText('Vitrine')).toBeTruthy();
    expect(loadDeviceToken()).toBe('device');
    expect(api.writes()[0]!.body).toEqual({ code: '123456' });
  });

  it('shows why a code did not work', async () => {
    renderScan();
    fireEvent.change(await screen.findByLabelText('Code von der Station'), {
      target: { value: '999999' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Koppeln' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/abgelaufen/);
    expect(loadDeviceToken()).toBeNull();
  });

  it('pairs right away when opened from the QR code', async () => {
    const { api } = renderScan('/scan?t=qr-token');
    expect(await screen.findByText('Kasse', { selector: '.scan-header strong' })).toBeTruthy();
    expect(api.writes()[0]!.body).toEqual({ qrToken: 'qr-token' });
  });

  it('stays paired after a reload', async () => {
    saveDeviceToken('device');
    const { api } = renderScan('/scan', { paired: true });
    expect(await screen.findByText('Kasse', { selector: '.scan-header strong' })).toBeTruthy();
    expect(api.writes()).toEqual([]);
  });

  it('returns to the code entry when the workstation disconnects', async () => {
    saveDeviceToken('device');
    const { realtime, unpair } = renderScan('/scan', { paired: true });
    await screen.findByText('Kasse', { selector: '.scan-header strong' });
    // The phone listens on the channel of its workstation once it knows it.
    await waitFor(() =>
      expect(realtime.latest().sent).toContainEqual({
        type: 'subscribe',
        channels: ['workstation:7'],
      }),
    );
    unpair();
    act(() =>
      realtime.latest().receive({
        type: 'event',
        event: { type: 'pairing.changed', action: 'deleted', workstationId: 7, pairingId: 1 },
      }),
    );
    expect(await screen.findByText(/Kopplung wurde an der Station/)).toBeTruthy();
    expect(screen.getByLabelText('Code von der Station')).toBeTruthy();
    expect(loadDeviceToken()).toBeNull();
  });

  it('disconnects from the phone', async () => {
    saveDeviceToken('device');
    renderScan('/scan', { paired: true });
    fireEvent.click(await screen.findByRole('button', { name: 'Trennen' }));
    await waitFor(() => expect(screen.getByLabelText('Code von der Station')).toBeTruthy());
    expect(loadDeviceToken()).toBeNull();
  });
});
