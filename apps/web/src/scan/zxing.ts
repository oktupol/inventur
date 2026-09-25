import { BrowserMultiFormatReader } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';

/**
 * Fallback decoder for browsers without the BarcodeDetector API (e.g. Safari
 * on iOS). Loaded on demand, so it does not enlarge the main bundle. The
 * decoder reads one code from a canvas and returns null if there is none.
 */
export function createZxingDecoder(): (canvas: HTMLCanvasElement) => string | null {
  const hints = new Map<DecodeHintType, unknown>([
    [
      DecodeHintType.POSSIBLE_FORMATS,
      [
        BarcodeFormat.EAN_13,
        BarcodeFormat.EAN_8,
        BarcodeFormat.UPC_A,
        BarcodeFormat.UPC_E,
        BarcodeFormat.CODE_128,
        BarcodeFormat.CODE_39,
        BarcodeFormat.QR_CODE,
      ],
    ],
  ]);
  const reader = new BrowserMultiFormatReader(hints);
  return (canvas) => {
    try {
      return reader.decodeFromCanvas(canvas).getText();
    } catch {
      // No code in this picture.
      return null;
    }
  };
}
