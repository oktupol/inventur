import type { StocktakeStatus, WorkAreaStatus } from '@inventur/shared';

export const WORK_AREA_STATUS_LABELS: Record<WorkAreaStatus, string> = {
  open: 'offen',
  in_progress: 'in Arbeit',
  closed: 'abgeschlossen',
};

export const STOCKTAKE_STATUS_LABELS: Record<StocktakeStatus, string> = {
  active: 'aktiv',
  finished: 'beendet',
};

const dateTime = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
const number = new Intl.NumberFormat('de-DE');

export function formatDateTime(iso: string | null): string {
  return iso === null ? '–' : dateTime.format(new Date(iso));
}

export function formatNumber(value: number): string {
  return number.format(value);
}

const euro = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const time = new Intl.DateTimeFormat('de-DE', { timeStyle: 'medium' });

/** Formats a decimal string in EUR, e.g. "1234.5" as "1.234,50 €". */
export function formatEuro(amount: string | number): string {
  return euro.format(Number(amount));
}

export function formatTime(iso: string): string {
  return time.format(new Date(iso));
}
