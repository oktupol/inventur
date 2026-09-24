import bwipjs from 'bwip-js';
import type { ContentSvg } from 'pdfmake/interfaces.js';
import { MM } from './render.ts';

export type BarcodeSymbology = 'ean13' | 'code128';

/** Nominal module width of EAN-13 (magnification 100 %). */
export const NOMINAL_MODULE_MM = 0.33;

/** Bar heights: EAN-13 nominal size, Code 128 comfortably tall for hand scanners and phones. */
const BAR_HEIGHT_MM: Record<BarcodeSymbology, number> = { ean13: 22.85, code128: 15 };

/** Quiet zones in modules (left, right) as required by the symbologies. */
export const QUIET_ZONE_MODULES: Record<BarcodeSymbology, [number, number]> = {
  ean13: [11, 7],
  code128: [10, 10],
};

export interface Barcode {
  content: ContentSvg;
  /** Width of the bars without quiet zones. */
  widthMm: number;
  moduleMm: number;
}

/**
 * Renders a barcode as vector graphics. The module width is the nominal
 * 0.33 mm unless the code plus its quiet zones would not fit into `maxWidthMm`.
 * The human-readable text is printed separately.
 */
export function barcode(code: string, symbology: BarcodeSymbology, maxWidthMm: number): Barcode {
  const svg = bwipjs.toSVG({ bcid: symbology, text: code, scale: 1, height: 10 });
  const viewBox = /viewBox="0 0 (\d+(?:\.\d+)?) /.exec(svg);
  if (!viewBox) throw new Error('Unexpected SVG from bwip-js');
  // bwip-js draws one unit per module at scale 1.
  const modules = Number(viewBox[1]);
  const [left, right] = QUIET_ZONE_MODULES[symbology];
  const moduleMm = Math.min(NOMINAL_MODULE_MM, maxWidthMm / (modules + left + right));
  const widthMm = modules * moduleMm;
  return {
    content: {
      // Stretch to the exact size instead of keeping the SVG's aspect ratio.
      svg: svg.replace('<svg ', '<svg preserveAspectRatio="none" '),
      width: widthMm * MM,
      height: BAR_HEIGHT_MM[symbology] * MM,
      alignment: 'center',
    },
    widthMm,
    moduleMm,
  };
}
