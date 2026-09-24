import pdfmake from 'pdfmake';
import type { TDocumentDefinitions } from 'pdfmake/interfaces.js';

// The 14 standard PDF fonts need no font files and cover German umlauts, € and „“.
const HELVETICA = {
  normal: 'Helvetica',
  bold: 'Helvetica-Bold',
  italics: 'Helvetica-Oblique',
  bolditalics: 'Helvetica-BoldOblique',
};
const STANDARD_FONTS = new Set(Object.values(HELVETICA));

pdfmake.setFonts({ Helvetica: HELVETICA });
// Documents never load external resources. pdfmake also checks font names
// against the local policy, so the standard fonts are allowed by name.
pdfmake.setUrlAccessPolicy(() => false);
pdfmake.setLocalAccessPolicy((path) => STANDARD_FONTS.has(path));

export const MM = 72 / 25.4;

/** Renders a pdfmake document to a PDF buffer. Default font is Helvetica. */
export async function renderPdf(document: TDocumentDefinitions): Promise<Buffer> {
  return pdfmake
    .createPdf({ ...document, defaultStyle: { font: 'Helvetica', ...document.defaultStyle } })
    .getBuffer();
}
