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

describe('app routes', () => {
  afterEach(cleanup);

  it.each([
    ['Arbeitsstation', '/'],
    ['Admin-Dashboard', '/admin'],
    ['Handy-Scanner', '/scan'],
    ['Seite nicht gefunden', '/does-not-exist'],
  ])('shows the heading "%s" at %s', (heading, path) => {
    renderAt(path);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(heading);
  });
});
