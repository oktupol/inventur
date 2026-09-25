import type { Cell, Column, Table } from './table.ts';
import { yieldEvery } from './yield.ts';
import { createZip } from './zip.ts';

/**
 * A single-sheet XLSX workbook: a bold, frozen header row with a filter,
 * amounts in EUR, times in local time and texts that stay text (EANs).
 */

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const RELATIONSHIPS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE_RELATIONSHIPS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** Style indexes in `cellXfs`. */
const STYLE = { header: 1, amount: 2, datetime: 3 } as const;

const STYLES = `${XML}<styleSheet xmlns="${MAIN}">
<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00\\ &quot;€&quot;"/><numFmt numFmtId="165" formatCode="dd.mm.yyyy\\ hh:mm:ss"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Standard" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function escapeXml(value: string): string {
  return (
    value
      // Control characters are not allowed in XML.
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
  );
}

/** Column letters: 0 → A, 25 → Z, 26 → AA. */
export function columnName(index: number): string {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  }
  return name;
}

/** Excel date serial of the local time, which Excel shows without converting. */
export function excelDate(date: Date): number {
  return (date.getTime() - date.getTimezoneOffset() * 60_000) / 86_400_000 + 25_569;
}

/** Sheet names have at most 31 characters and none of []:*?/\. */
export function sheetName(name: string): string {
  return name.replace(/[[\]:*?/\\]/g, '-').slice(0, 31) || 'Tabelle';
}

function inlineString(ref: string, value: string, style = 0): string {
  const s = style ? ` s="${style}"` : '';
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

function cellXml(cell: Cell, column: Column, ref: string): string {
  if (cell === null || cell === '') return '';
  if (cell instanceof Date)
    return `<c r="${ref}" s="${STYLE.datetime}"><v>${excelDate(cell)}</v></c>`;
  if (typeof cell === 'number') return `<c r="${ref}"><v>${cell}</v></c>`;
  if (column.type === 'amount') return `<c r="${ref}" s="${STYLE.amount}"><v>${cell}</v></c>`;
  return inlineString(ref, cell);
}

function columnWidth(table: Table, index: number): number {
  const column = table.columns[index]!;
  if (column.type === 'datetime') return 20;
  if (column.type === 'amount') return 15;
  let longest = column.header.length;
  for (const row of table.rows) {
    const cell = row[index];
    if (typeof cell === 'string' || typeof cell === 'number') {
      longest = Math.max(longest, String(cell).length);
    }
  }
  return Math.min(60, longest + 2);
}

async function worksheet(table: Table): Promise<string> {
  const last = columnName(table.columns.length - 1);
  const rows = [
    `<row r="1">${table.columns
      .map((column, index) => inlineString(`${columnName(index)}1`, column.header, STYLE.header))
      .join('')}</row>`,
  ];
  const pause = yieldEvery();
  for (const [rowIndex, row] of table.rows.entries()) {
    const r = rowIndex + 2;
    const cells = row
      .map((cell, index) => cellXml(cell, table.columns[index]!, `${columnName(index)}${r}`))
      .join('');
    rows.push(`<row r="${r}">${cells}</row>`);
    await pause();
  }
  const cols = table.columns
    .map((_, index) => {
      const n = index + 1;
      return `<col min="${n}" max="${n}" width="${columnWidth(table, index)}" customWidth="1"/>`;
    })
    .join('');
  return (
    `${XML}<worksheet xmlns="${MAIN}" xmlns:r="${RELATIONSHIPS}">` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<cols>${cols}</cols><sheetData>${rows.join('')}</sheetData>` +
    `<autoFilter ref="A1:${last}${table.rows.length + 1}"/></worksheet>`
  );
}

export async function toXlsx(table: Table, name: string): Promise<Buffer> {
  const sheet = sheetName(name);
  const last = columnName(table.columns.length - 1);
  const filterRange = `'${sheet.replaceAll("'", "''")}'!$A$1:$${last}$${table.rows.length + 1}`;
  const files = {
    '[Content_Types].xml':
      `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
      `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
      `</Types>`,
    '_rels/.rels':
      `${XML}<Relationships xmlns="${PACKAGE_RELATIONSHIPS}">` +
      `<Relationship Id="rId1" Type="${RELATIONSHIPS}/officeDocument" Target="xl/workbook.xml"/>` +
      `</Relationships>`,
    'xl/workbook.xml':
      `${XML}<workbook xmlns="${MAIN}" xmlns:r="${RELATIONSHIPS}">` +
      `<sheets><sheet name="${escapeXml(sheet)}" sheetId="1" r:id="rId1"/></sheets>` +
      `<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">${escapeXml(filterRange)}</definedName></definedNames>` +
      `</workbook>`,
    'xl/_rels/workbook.xml.rels':
      `${XML}<Relationships xmlns="${PACKAGE_RELATIONSHIPS}">` +
      `<Relationship Id="rId1" Type="${RELATIONSHIPS}/worksheet" Target="worksheets/sheet1.xml"/>` +
      `<Relationship Id="rId2" Type="${RELATIONSHIPS}/styles" Target="styles.xml"/>` +
      `</Relationships>`,
    'xl/styles.xml': STYLES,
    'xl/worksheets/sheet1.xml': await worksheet(table),
  };
  return createZip(
    Object.entries(files).map(([file, content]) => ({
      name: file,
      data: Buffer.from(content, 'utf8'),
    })),
  );
}
