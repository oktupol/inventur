import type { WorkAreaStatus } from '@inventur/shared';
import type { Column, Content, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces.js';
import { fromCents, lineCents } from '../money.ts';
import { MM } from '../pdf/render.ts';
import {
  sumCountLists,
  type CountListPosition,
  type CountListSection,
  type CountListTotals,
  type WorkAreaCountList,
} from './model.ts';

// The count list is printed and signed, so its texts are German. Times are
// local (TZ, Europe/Berlin in the container).

export interface CountListInfo {
  stocktakeName: string;
  createdAt: Date;
  /** Counting list of a single work area or of the whole stocktake. */
  scope: 'work_area' | 'stocktake';
}

const STATUS_LABELS: Record<WorkAreaStatus, string> = {
  open: 'offen',
  in_progress: 'in Arbeit',
  closed: 'abgeschlossen',
};

const euro = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const integer = new Intl.NumberFormat('de-DE');
const dateTime = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
const date = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' });
const time = new Intl.DateTimeFormat('de-DE', { timeStyle: 'short' });

const formatEuro = (amount: string) => euro.format(Number(amount));
const lineCount = (lines: number) => `${integer.format(lines)} ${lines === 1 ? 'Zeile' : 'Zeilen'}`;

const GRAY = '#666666';
const SUBTOTAL_FILL = '#eeeeee';

/** Width of the content between the page margins of 15 mm. */
const CONTENT_WIDTH = (210 - 2 * 15) * MM;
const SIGNATURE_GAP = 30;
const SIGNATURE_WIDTH = (CONTENT_WIDTH - SIGNATURE_GAP) / 2;
const DATE_WIDTH = 70;

/** Pos., Zeit, Bezeichnung, EAN/Art.-Nr., Seriennr., Menge, Preis, Summe; times with a date need more space. */
function widths(showDate: boolean): (number | string)[] {
  return [22, showDate ? 62 : 28, '*', 64, 46, 28, 50, 56];
}
const COLUMN_COUNT = widths(false).length;

function sameDay(a: Date, b: Date): boolean {
  return date.format(a) === date.format(b);
}

function period(area: WorkAreaCountList): string {
  if (!area.period) return '–';
  const { from, to } = area.period;
  return sameDay(from, to)
    ? `${date.format(from)}, ${time.format(from)} – ${time.format(to)}`
    : `${dateTime.format(from)} – ${dateTime.format(to)}`;
}

function positionRow(position: CountListPosition, showDate: boolean): TableCell[] {
  const code = position.ean ?? position.input;
  const description: TableCell = position.isManual
    ? { text: [position.description, { text: '  (manuell)', italics: true, color: GRAY }] }
    : { text: position.description };
  return [
    { text: String(position.position), alignment: 'right' },
    { text: showDate ? dateTime.format(position.createdAt) : time.format(position.createdAt) },
    description,
    { text: code },
    { text: position.serialNumber ?? '' },
    { text: integer.format(position.quantity), alignment: 'right' },
    { text: formatEuro(position.priceGross), alignment: 'right', noWrap: true },
    {
      text: formatEuro(fromCents(lineCents(position.priceGross, position.quantity))),
      alignment: 'right',
      noWrap: true,
    },
  ];
}

function totalsRow(label: string, totals: CountListTotals, bold = false): TableCell[] {
  return [
    { text: label, colSpan: 5, bold, fillColor: SUBTOTAL_FILL },
    {},
    {},
    {},
    {},
    {
      text: integer.format(totals.quantity),
      alignment: 'right',
      bold,
      fillColor: SUBTOTAL_FILL,
    },
    { text: '', fillColor: SUBTOTAL_FILL },
    {
      text: formatEuro(totals.gross),
      alignment: 'right',
      bold,
      noWrap: true,
      fillColor: SUBTOTAL_FILL,
    },
  ];
}

function sectionRows(section: CountListSection, showDate: boolean): TableCell[][] {
  const rows = section.positions.map((position) => positionRow(position, showDate));
  const { checkpoint } = section;
  if (checkpoint) {
    const station = checkpoint.workstation ? `, ${checkpoint.workstation}` : '';
    rows.push(
      totalsRow(
        `Zwischensumme Checkpoint ${checkpoint.number} (${dateTime.format(checkpoint.createdAt)}${station}): ` +
          lineCount(checkpoint.section.lines),
        checkpoint.section,
        true,
      ),
      totalsRow(
        `Seit Beginn des Bereichs: ${lineCount(checkpoint.sinceStart.lines)}`,
        checkpoint.sinceStart,
      ),
    );
  }
  return rows;
}

function keyValueTable(rows: [string, string][]): Content {
  return {
    table: {
      widths: [110, '*'],
      body: rows.map(([key, value]) => [
        { text: key, color: GRAY },
        { text: value, bold: true },
      ]),
    },
    layout: 'noBorders',
    margin: [0, 0, 0, 10],
  };
}

function totalsTable(totals: CountListTotals): Content {
  return {
    table: {
      widths: [110, '*'],
      body: [
        ['Zeilen', integer.format(totals.lines)],
        ['Stück', integer.format(totals.quantity)],
        ['Wert netto', `${formatEuro(totals.net)} (ohne manuell erfasste Artikel)`],
        ['Wert brutto', formatEuro(totals.gross)],
      ].map(([key, value]) => [
        { text: key!, color: GRAY },
        { text: value!, bold: true },
      ]),
    },
    layout: 'noBorders',
    margin: [0, 12, 0, 0],
  };
}

function line(width: number): Content {
  return { canvas: [{ type: 'line', x1: 0, y1: 0, x2: width, y2: 0, lineWidth: 0.5 }] };
}

function signatureField(role: string, names: string): Column {
  return {
    width: SIGNATURE_WIDTH,
    stack: [
      { text: role, bold: true, margin: [0, 0, 0, 2] },
      { text: names, color: GRAY, fontSize: 8, margin: [0, 0, 0, 28] },
      {
        columns: [
          {
            width: DATE_WIDTH,
            stack: [line(DATE_WIDTH - 10), { text: 'Datum', fontSize: 7, color: GRAY }],
          },
          {
            width: '*',
            stack: [
              line(SIGNATURE_WIDTH - DATE_WIDTH),
              { text: 'Unterschrift', fontSize: 7, color: GRAY },
            ],
          },
        ],
        columnGap: 0,
      },
    ],
  };
}

function signatures(counters: string): Content {
  return {
    unbreakable: true,
    margin: [0, 24, 0, 0],
    columns: [
      signatureField('Gezählt (Zähler)', counters),
      signatureField('Verantwortlich', 'Name in Druckbuchstaben:'),
    ],
    columnGap: SIGNATURE_GAP,
  };
}

function workAreaContent(area: WorkAreaCountList, info: CountListInfo, first: boolean): Content[] {
  const showDate = area.period !== null && !sameDay(area.period.from, area.period.to);
  const body: TableCell[][] = [
    [
      {
        text: `Arbeitsbereich ${area.name}`,
        colSpan: COLUMN_COUNT,
        bold: true,
        border: [false, false, false, false],
      },
      ...Array<TableCell>(COLUMN_COUNT - 1).fill({}),
    ],
    [
      'Pos.',
      'Zeit',
      'Bezeichnung',
      'EAN / Art.-Nr.',
      'Seriennr.',
      'Menge',
      'Preis brutto',
      'Summe brutto',
    ].map((text, index): TableCell => ({
      text,
      bold: true,
      alignment: index === 0 || index >= 5 ? 'right' : 'left',
    })),
    ...area.sections.flatMap((section) => sectionRows(section, showDate)),
  ];
  if (area.totals.lines === 0) {
    body.push([
      { text: 'Keine Erfassungen.', colSpan: COLUMN_COUNT, italics: true, color: GRAY },
      ...Array<TableCell>(COLUMN_COUNT - 1).fill({}),
    ]);
  } else {
    body.push(totalsRow(`Summe ${area.name}: ${lineCount(area.totals.lines)}`, area.totals, true));
  }

  return [
    {
      text: `Zählliste ${area.name}`,
      fontSize: 16,
      bold: true,
      margin: [0, 0, 0, 8],
      ...(first ? {} : { pageBreak: 'before' as const }),
    },
    keyValueTable([
      ['Inventur', info.stocktakeName],
      ['Arbeitsbereich', area.description ? `${area.name} (${area.description})` : area.name],
      ['Status', STATUS_LABELS[area.status]],
      ['Erfasst', period(area)],
      ['Mitarbeiter', area.employees.join(', ') || '–'],
    ]),
    {
      table: { headerRows: 2, widths: widths(showDate), body, dontBreakRows: true },
      layout: {
        hLineWidth: (index) => (index === 2 ? 0.8 : 0.3),
        vLineWidth: () => 0,
        hLineColor: () => '#999999',
        paddingTop: () => 2,
        paddingBottom: () => 2,
      },
      fontSize: 8,
    },
    totalsTable(area.totals),
    signatures(area.employees.join(', ')),
  ];
}

function summaryContent(areas: readonly WorkAreaCountList[], info: CountListInfo): Content[] {
  const totals = sumCountLists(areas);
  const header = ['Arbeitsbereich', 'Status', 'Zeilen', 'Stück', 'Wert netto', 'Wert brutto'];
  const row = (cells: string[], bold = false): TableCell[] =>
    cells.map((text, index) => ({ text, bold, alignment: index >= 2 ? 'right' : 'left' }));
  return [
    { text: 'Zählliste – alle Arbeitsbereiche', fontSize: 16, bold: true, margin: [0, 0, 0, 8] },
    keyValueTable([
      ['Inventur', info.stocktakeName],
      ['Arbeitsbereiche', integer.format(areas.length)],
      ['Erstellt am', dateTime.format(info.createdAt)],
    ]),
    {
      table: {
        headerRows: 1,
        widths: ['*', 60, 45, 45, 75, 75],
        body: [
          row(header, true),
          ...areas.map((area) =>
            row([
              area.name,
              STATUS_LABELS[area.status],
              integer.format(area.totals.lines),
              integer.format(area.totals.quantity),
              formatEuro(area.totals.net),
              formatEuro(area.totals.gross),
            ]),
          ),
          row(
            [
              'Summe',
              '',
              integer.format(totals.lines),
              integer.format(totals.quantity),
              formatEuro(totals.net),
              formatEuro(totals.gross),
            ],
            true,
          ),
        ],
        dontBreakRows: true,
      },
      layout: 'lightHorizontalLines',
      fontSize: 9,
    },
    totalsTable(totals),
    {
      unbreakable: true,
      margin: [0, 24, 0, 0],
      columns: [
        signatureField('Verantwortlich', 'Name in Druckbuchstaben:'),
        { width: '*', text: '' },
      ],
    },
  ];
}

/** The printable count list of one work area or, with a summary first, of all work areas. */
export function countListDocument(
  areas: readonly WorkAreaCountList[],
  info: CountListInfo,
): TDocumentDefinitions {
  const title =
    info.scope === 'stocktake'
      ? `Zählliste ${info.stocktakeName}`
      : `Zählliste ${info.stocktakeName} – ${areas[0]?.name ?? ''}`;
  const content: Content[] =
    info.scope === 'stocktake'
      ? [
          ...summaryContent(areas, info),
          ...areas.flatMap((area) => workAreaContent(area, info, false)),
        ]
      : areas.flatMap((area, index) => workAreaContent(area, info, index === 0));

  return {
    pageSize: 'A4',
    pageMargins: [15 * MM, 15 * MM, 15 * MM, 15 * MM],
    info: { title },
    defaultStyle: { fontSize: 9 },
    header: () => ({
      text: title,
      fontSize: 7,
      color: GRAY,
      margin: [15 * MM, 7 * MM, 15 * MM, 0],
    }),
    footer: (currentPage, pageCount) => ({
      columns: [
        { text: `Erstellt am ${dateTime.format(info.createdAt)}`, fontSize: 7, color: GRAY },
        {
          text: `Seite ${currentPage} von ${pageCount}`,
          alignment: 'right',
          fontSize: 7,
          color: GRAY,
        },
      ],
      margin: [15 * MM, 5 * MM, 15 * MM, 0],
    }),
    content,
  };
}
