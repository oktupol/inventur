import type { Content, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces.js';
import { barcode } from '../pdf/barcode.ts';
import { MM } from '../pdf/render.ts';
import type { ExpectedResult, Label, SectionKind, TestSheet } from './selection.ts';

export interface SheetInfo {
  createdAt: Date;
  seed: number;
  articleCount: number;
}

// The sheet is printed and read by users, so its texts are German.
const SECTIONS: Record<SectionKind, { title: string; text: string }> = {
  unique_ean: {
    title: '1. Eindeutig per EAN',
    text: 'EAN-13 eines einzelnen Artikels. Der Artikel wird direkt erfasst.',
  },
  unique_article_number: {
    title: '2. Eindeutig per Artikelnummer',
    text: 'Code 128 mit der Artikelnummer eines Artikels ohne EAN. Der Artikel wird direkt erfasst.',
  },
  ambiguous: {
    title: '3. Mehrdeutig',
    text: 'EAN oder Artikelnummer, die zu mehreren Artikeln gehört. Der richtige Artikel muss ausgewählt werden.',
  },
  not_found: {
    title: '4. Unbekannt',
    text: 'Gültige EAN-13, die in den Stammdaten nicht vorkommt. Es ertönt ein Ton, und die manuelle Erfassung wird angeboten.',
  },
};

const EXPECTED: Record<ExpectedResult, { text: string; color: string }> = {
  unique: { text: 'Erwartet: GRÜN (eindeutig)', color: '#1a7f37' },
  ambiguous: { text: 'Erwartet: GELB (mehrdeutig)', color: '#9a6700' },
  not_found: { text: 'Erwartet: ROT (unbekannt)', color: '#cf222e' },
};

const PAGE_MARGIN_MM = 10;
const COLUMNS = 3;
const CELL_PADDING_MM = 2;
const COLUMN_WIDTH_MM = (210 - 2 * PAGE_MARGIN_MM) / COLUMNS;
/** Space for bars and quiet zones inside a label. */
export const LABEL_BARCODE_WIDTH_MM = COLUMN_WIDTH_MM - 2 * CELL_PADDING_MM - 1;

const euro = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
// The container runs in UTC; the shop is in Germany.
const dateTime = new Intl.DateTimeFormat('de-DE', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Europe/Berlin',
});
const integer = new Intl.NumberFormat('de-DE');

function truncate(text: string, length: number): string {
  return text.length <= length ? text : `${text.slice(0, length - 1).trimEnd()}…`;
}

function labelText(label: Label): { description: string; price: string } {
  const [first] = label.articles;
  if (!first) return { description: 'Nicht in den Stammdaten', price: '–' };
  if (label.articles.length === 1) {
    return {
      description: truncate(first.description, 80),
      price: euro.format(Number(first.priceGross)),
    };
  }
  return {
    description: truncate(
      `${label.articles.length} Artikel: ${label.articles.map((a) => a.description).join(' · ')}`,
      80,
    ),
    price: label.articles.map((a) => euro.format(Number(a.priceGross))).join(' / '),
  };
}

function labelCell(label: Label): TableCell {
  const { description, price } = labelText(label);
  const expected = EXPECTED[label.expected];
  return {
    stack: [
      barcode(label.code, label.symbology, LABEL_BARCODE_WIDTH_MM).content,
      { text: label.code, bold: true, fontSize: 10, alignment: 'center', margin: [0, 2, 0, 3] },
      { text: description, fontSize: 7, margin: [0, 0, 0, 2] },
      { text: truncate(price, 60), fontSize: 8, bold: true },
      { text: expected.text, fontSize: 8, bold: true, color: expected.color, margin: [0, 2, 0, 0] },
    ],
  };
}

function sectionContent(kind: SectionKind, labels: Label[]): Content[] {
  const { title, text } = SECTIONS[kind];
  const heading: Content[] = [
    { text: title, fontSize: 13, bold: true, margin: [0, 10, 0, 2] },
    { text, fontSize: 9, margin: [0, 0, 0, 5] },
  ];
  if (labels.length === 0) {
    return [
      ...heading,
      {
        text: 'Ausgelassen: Die Stammdaten enthalten dafür keine passenden Artikel.',
        italics: true,
        fontSize: 9,
      },
    ];
  }

  const rows: TableCell[][] = [];
  for (let i = 0; i < labels.length; i += COLUMNS) {
    const row = labels.slice(i, i + COLUMNS).map(labelCell);
    while (row.length < COLUMNS) row.push({ text: '', border: [false, false, false, false] });
    rows.push(row);
  }
  return [
    ...heading,
    {
      table: { widths: Array(COLUMNS).fill('*'), body: rows, dontBreakRows: true },
      layout: {
        // Light lines as cutting guides.
        hLineColor: () => '#bbbbbb',
        vLineColor: () => '#bbbbbb',
        paddingLeft: () => CELL_PADDING_MM * MM,
        paddingRight: () => CELL_PADDING_MM * MM,
        paddingTop: () => 3 * MM,
        paddingBottom: () => 3 * MM,
      },
    },
  ];
}

/** Builds the printable barcode test sheet (A4 label grid). */
export function testSheetDocument(sheet: TestSheet, info: SheetInfo): TDocumentDefinitions {
  return {
    pageSize: 'A4',
    pageMargins: PAGE_MARGIN_MM * MM,
    info: { title: 'Barcode-Testblatt' },
    content: [
      { text: 'Barcode-Testblatt', fontSize: 18, bold: true },
      {
        text:
          `Erstellt am ${dateTime.format(info.createdAt)} · Startwert ${info.seed} · ` +
          `${integer.format(info.articleCount)} Artikel in den Stammdaten`,
        fontSize: 9,
        margin: [0, 2, 0, 4],
      },
      {
        text:
          'Zum Testen von Barcode-Scannern und der Handykamera. Jedes Etikett nennt das erwartete ' +
          'Ergebnis bei der Erfassung. Bitte in Originalgröße drucken (100 %, nicht „An Seite ' +
          'anpassen“), damit die Barcodes die Nenngröße haben.',
        fontSize: 9,
      },
      ...sheet.sections.flatMap((section) => sectionContent(section.kind, section.labels)),
    ],
    footer: (page, pages) => ({
      text: `Seite ${page} von ${pages}`,
      alignment: 'center',
      fontSize: 8,
      margin: [0, 3 * MM, 0, 0],
    }),
  };
}
