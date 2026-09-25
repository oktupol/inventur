import { describe, expect, it } from 'vitest';
import { formatDateTime, germanDecimal, toCsv } from './csv.ts';
import type { Table } from './table.ts';

const table: Table = {
  columns: [
    { header: 'Bezeichnung', type: 'text' },
    { header: 'EAN', type: 'text' },
    { header: 'Menge', type: 'integer' },
    { header: 'Preis', type: 'amount' },
    { header: 'Zeitpunkt', type: 'datetime' },
  ],
  rows: [
    ['Ring "Größe 58"; Gold', '4000000000017', 2, '1234.50', new Date('2026-09-25T06:15:30Z')],
    ['Kette\nlang', '0012', 1, '-0.10', null],
    ['Uhr', '12345', 1, null, null],
  ],
};

describe('toCsv', () => {
  it('writes UTF-8 with a byte order mark, semicolons and CRLF', async () => {
    const csv = await toCsv(table);
    expect(csv.startsWith('﻿Bezeichnung;EAN;Menge;Preis;Zeitpunkt\r\n')).toBe(true);
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('formats amounts with a decimal comma and local times', async () => {
    const lines = (await toCsv(table)).slice(1).split('\r\n');
    expect(lines[1]).toBe(
      '"Ring ""Größe 58""; Gold";="4000000000017";2;1234,50;25.09.2026 08:15:30',
    );
    // Line breaks within a quoted field stay LF.
    expect(lines[2]).toBe('"Kette\nlang";="0012";1;-0,10;');
    expect(lines[3]).toBe('Uhr;12345;1;;');
  });

  it('formats single values', () => {
    expect(germanDecimal('0.05')).toBe('0,05');
    expect(formatDateTime(new Date('2026-01-02T23:05:09Z'))).toBe('03.01.2026 00:05:09');
  });
});
