import { inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { Table } from './table.ts';
import { columnName, excelDate, sheetName, toXlsx } from './xlsx.ts';

/** Reads the files of a ZIP archive written without data descriptors. */
function unzip(zip: Buffer): Map<string, string> {
  const files = new Map<string, string>();
  let offset = 0;
  while (zip.readUInt32LE(offset) === 0x04034b50) {
    const size = zip.readUInt32LE(offset + 18);
    const nameLength = zip.readUInt16LE(offset + 26);
    const extraLength = zip.readUInt16LE(offset + 28);
    const name = zip.toString('utf8', offset + 30, offset + 30 + nameLength);
    const start = offset + 30 + nameLength + extraLength;
    files.set(name, inflateRawSync(zip.subarray(start, start + size)).toString('utf8'));
    offset = start + size;
  }
  return files;
}

const table: Table = {
  columns: [
    { header: 'Bezeichnung', type: 'text' },
    { header: 'EAN', type: 'text' },
    { header: 'Menge', type: 'integer' },
    { header: 'Preis', type: 'amount' },
    { header: 'Zeitpunkt', type: 'datetime' },
  ],
  rows: [
    ['Ring <Größe> & "Gold"', '0400000000017', 2, '1234.50', new Date('2026-09-25T06:00:00Z')],
    ['Kette', null, 1, null, null],
  ],
};

describe('toXlsx', () => {
  it('contains a workbook with one sheet, styles and relationships', async () => {
    const files = unzip(await toXlsx(table, 'Vitrine 3'));
    expect([...files.keys()]).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/worksheets/sheet1.xml',
    ]);
    expect(files.get('xl/workbook.xml')).toContain(
      '<sheet name="Vitrine 3" sheetId="1" r:id="rId1"/>',
    );
    expect(files.get('xl/workbook.xml')).toContain("'Vitrine 3'!$A$1:$E$3");
  });

  it('writes texts as text, numbers and amounts as numbers and times as dates', async () => {
    const sheet = unzip(await toXlsx(table, 'Export')).get('xl/worksheets/sheet1.xml')!;
    expect(sheet).toContain(
      '<c r="A1" s="1" t="inlineStr"><is><t xml:space="preserve">Bezeichnung</t></is></c>',
    );
    expect(sheet).toContain(
      '<c r="A2" t="inlineStr"><is><t xml:space="preserve">Ring &lt;Größe&gt; &amp; &quot;Gold&quot;</t></is></c>',
    );
    expect(sheet).toContain(
      '<c r="B2" t="inlineStr"><is><t xml:space="preserve">0400000000017</t></is></c>',
    );
    expect(sheet).toContain('<c r="C2"><v>2</v></c>');
    expect(sheet).toContain('<c r="D2" s="2"><v>1234.50</v></c>');
    expect(sheet).toContain(
      `<c r="E2" s="3"><v>${excelDate(new Date('2026-09-25T06:00:00Z'))}</v></c>`,
    );
    // Empty cells are left out.
    expect(sheet).toContain(
      '<row r="3"><c r="A3" t="inlineStr"><is><t xml:space="preserve">Kette</t></is></c><c r="C3"><v>1</v></c></row>',
    );
    expect(sheet).toContain(
      '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>',
    );
    expect(sheet).toContain('<autoFilter ref="A1:E3"/>');
  });

  it('converts times to local Excel dates', () => {
    // 2026-09-25 08:00 in Berlin (UTC+2) is day 46290 plus a third.
    expect(excelDate(new Date('2026-09-25T06:00:00Z'))).toBeCloseTo(46290 + 8 / 24, 9);
  });

  it('names columns and sheets as Excel expects', () => {
    expect([0, 25, 26, 27, 701, 702].map(columnName)).toEqual(['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA']);
    expect(sheetName('Lager: Regal [1/2]?')).toBe('Lager- Regal -1-2--');
    expect(sheetName('Ein sehr langer Name eines Arbeitsbereichs')).toHaveLength(31);
  });
});
