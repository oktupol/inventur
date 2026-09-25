import { yieldEvery } from './yield.ts';
import type { Cell, Column, Table } from './table.ts';

/**
 * CSV as Excel opens it directly with German settings: UTF-8 with a byte
 * order mark, semicolons, decimal commas and CRLF line ends.
 */

const BOM = '﻿';

/** Formats a decimal string with a comma and without thousands separators, e.g. "-1234,50". */
export function germanDecimal(amount: string): string {
  return amount.replace('.', ',');
}

const pad = (value: number) => String(value).padStart(2, '0');

/** Local time as Excel reads it, e.g. "25.09.2026 08:15:30". */
export function formatDateTime(date: Date): string {
  return (
    `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

function quote(value: string): string {
  return /[";\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/**
 * Excel turns long digit strings such as EANs into numbers ("4E+12") and
 * drops leading zeros. As a formula returning text, they stay as they are.
 */
function text(value: string): string {
  if (/^\d+$/.test(value) && (value.length > 11 || value.startsWith('0'))) {
    return `="${value}"`;
  }
  return quote(value);
}

function formatCell(cell: Cell, column: Column): string {
  if (cell === null || cell === '') return '';
  if (cell instanceof Date) return formatDateTime(cell);
  if (typeof cell === 'number') return String(cell);
  return column.type === 'amount' ? germanDecimal(cell) : text(cell);
}

export async function toCsv(table: Table): Promise<string> {
  const lines = [table.columns.map((column) => quote(column.header)).join(';')];
  const pause = yieldEvery();
  for (const row of table.rows) {
    lines.push(row.map((cell, index) => formatCell(cell, table.columns[index]!)).join(';'));
    await pause();
  }
  return `${BOM}${lines.join('\r\n')}\r\n`;
}
