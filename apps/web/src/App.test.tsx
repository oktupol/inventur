import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.tsx';
import { RealtimeProvider } from './realtime/RealtimeProvider.tsx';
import { stubApi } from './test-utils/fake-api.ts';
import { createFakeRealtime } from './test-utils/fake-realtime.ts';

function renderAt(path: string) {
  render(
    <RealtimeProvider client={createFakeRealtime().client}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </RealtimeProvider>,
  );
}

describe('app routes', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it.each([
    ['Arbeitsstation einrichten', '/'],
    ['Inventur', '/admin'],
    ['Arbeitsstationen', '/admin/stationen'],
    ['Handy-Scanner', '/scan'],
    ['Seite nicht gefunden', '/does-not-exist'],
  ])('shows the heading "%s" at %s', (heading, path) => {
    stubApi(() => ({ status: 503, body: { error: 'x', code: 'internal_error' } }));
    renderAt(path);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(heading);
  });
});
