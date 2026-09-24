import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from './App.tsx';

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

describe('App-Routen', () => {
  afterEach(cleanup);

  it.each([
    ['/', 'Arbeitsstation'],
    ['/admin', 'Admin-Dashboard'],
    ['/scan', 'Handy-Scanner'],
    ['/gibt-es-nicht', 'Seite nicht gefunden'],
  ])('zeigt unter %s die Seite „%s“', (path, heading) => {
    renderAt(path);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(heading);
  });
});
