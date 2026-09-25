import type { Entry } from '@inventur/shared';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EntryTable } from './EntryTable.tsx';

afterEach(cleanup);

function entry(id: number, articleId: number | null): Entry {
  return {
    id,
    workAreaId: 4,
    articleId,
    isManual: articleId === null,
    input: String(articleId),
    description: `Artikel ${articleId}`,
    ean: null,
    category: null,
    priceNet: null,
    priceGross: '10.00',
    serialNumber: null,
    quantity: 1,
    workstation: { id: 1, name: 'Kasse' },
    createdAt: new Date(2026, 0, 1, 10, 0, id).toISOString(),
    updatedAt: new Date(2026, 0, 1, 10, 0, id).toISOString(),
    duplicateCount: 0,
    checkpointNumber: null,
  };
}

const rowClasses = () =>
  Object.fromEntries(
    [...document.querySelectorAll('table.entries tbody tr')].map((row) => [
      row.getAttribute('data-entry-id'),
      row.className,
    ]),
  );

describe('EntryTable', () => {
  it('highlights the other lines of the selected article', () => {
    const entries = [entry(5, 1), entry(4, null), entry(3, 2), entry(2, 1), entry(1, 1)];
    const { rerender } = render(<EntryTable entries={entries} selectedId={2} />);
    expect(rowClasses()).toEqual({
      5: 'same-article',
      4: '',
      3: '',
      2: 'selected',
      1: 'same-article',
    });

    rerender(<EntryTable entries={entries} selectedId={3} />);
    expect(Object.values(rowClasses()).filter((c) => c === 'same-article')).toEqual([]);
  });

  it('does not treat manual lines as the same article', () => {
    render(<EntryTable entries={[entry(2, null), entry(1, null)]} selectedId={2} />);
    expect(rowClasses()).toEqual({ 2: 'selected', 1: '' });
  });
});
