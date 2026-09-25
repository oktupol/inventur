/** Formats read by the phone camera, named as in the BarcodeDetector API. */
export const BARCODE_FORMATS = [
  'ean_13',
  'ean_8',
  'upc_a',
  'upc_e',
  'code_128',
  'code_39',
  'qr_code',
] as const;

import { frameToVideoRegion, type Rect } from './region.ts';

interface DetectedBarcode {
  rawValue: string;
}

interface Detector {
  detect(source: HTMLCanvasElement): Promise<DetectedBarcode[]>;
}

export interface DetectorConstructor {
  new (options: { formats: string[] }): Detector;
  getSupportedFormats?(): Promise<string[]>;
}

export interface CameraEnvironment {
  mediaDevices: Pick<MediaDevices, 'getUserMedia'> | undefined;
  BarcodeDetector: DetectorConstructor | undefined;
  loadZxing: () => Promise<{
    createZxingDecoder: () => (canvas: HTMLCanvasElement) => string | null;
  }>;
  createCanvas: () => HTMLCanvasElement;
}

export interface CameraOptions {
  /**
   * The scan frame in pixels of the video element. Only codes in the camera
   * picture below it are read; without a frame, the whole picture is used.
   */
  frame?: () => Rect | null;
}

export interface CameraScanner {
  /** "native" uses the BarcodeDetector API, "zxing" the JavaScript fallback. */
  engine: 'native' | 'zxing';
  stop: () => void;
}

/** Explains camera errors to the user. */
export class CameraError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CameraError';
  }
}

/** Pause between two detection attempts. */
const DETECT_INTERVAL_MS = 120;

function defaultEnvironment(): CameraEnvironment {
  return {
    mediaDevices: navigator.mediaDevices,
    BarcodeDetector: (globalThis as { BarcodeDetector?: DetectorConstructor }).BarcodeDetector,
    loadZxing: () => import('./zxing.ts'),
    createCanvas: () => document.createElement('canvas'),
  };
}

function cameraError(error: unknown): CameraError {
  const name = error instanceof DOMException ? error.name : '';
  switch (name) {
    case 'NotAllowedError':
      return new CameraError(
        'Der Zugriff auf die Kamera wurde nicht erlaubt. Bitte in den Einstellungen des Browsers die Kamera für diese Seite freigeben.',
      );
    case 'NotFoundError':
    case 'OverconstrainedError':
      return new CameraError('Es wurde keine Kamera gefunden.');
    case 'NotReadableError':
      return new CameraError('Die Kamera wird gerade von einer anderen App verwendet.');
    default:
      return new CameraError('Die Kamera konnte nicht gestartet werden.');
  }
}

/** Native detection with the formats the browser supports; null if it cannot read EAN-13. */
async function nativeDetector(
  BarcodeDetector: DetectorConstructor | undefined,
): Promise<Detector | null> {
  if (!BarcodeDetector) return null;
  const supported = (await BarcodeDetector.getSupportedFormats?.()) ?? [...BARCODE_FORMATS];
  const formats = BARCODE_FORMATS.filter((format) => supported.includes(format));
  if (!formats.includes('ean_13')) return null;
  return new BarcodeDetector({ formats });
}

/**
 * Copies the part of the camera picture below the scan frame into `canvas`.
 * Returns false while the video has no picture yet.
 */
function captureFrame(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  frame: Rect | null,
): boolean {
  const picture = { width: video.videoWidth, height: video.videoHeight };
  const region = frame
    ? frameToVideoRegion(picture, { width: video.clientWidth, height: video.clientHeight }, frame)
    : picture.width > 0 && picture.height > 0
      ? { x: 0, y: 0, ...picture }
      : null;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!region || !context) return false;
  canvas.width = region.width;
  canvas.height = region.height;
  context.drawImage(
    video,
    region.x,
    region.y,
    region.width,
    region.height,
    0,
    0,
    region.width,
    region.height,
  );
  return true;
}

/**
 * Starts the rear camera in `video` and reports every code detected within
 * the scan frame. Uses the BarcodeDetector API where available and ZXing
 * otherwise.
 */
export async function startCamera(
  video: HTMLVideoElement,
  onCode: (code: string) => void,
  options: CameraOptions = {},
  environment: CameraEnvironment = defaultEnvironment(),
): Promise<CameraScanner> {
  if (!environment.mediaDevices) {
    throw new CameraError(
      'Die Kamera ist nur über eine sichere Verbindung (https://) verfügbar. Bitte die Seite über den QR-Code der Station öffnen.',
    );
  }
  let stream: MediaStream;
  try {
    stream = await environment.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' } },
    });
  } catch (error) {
    throw cameraError(error);
  }
  video.muted = true;
  video.setAttribute('playsinline', '');
  video.srcObject = stream;
  const stopStream = () => {
    for (const track of stream.getTracks()) track.stop();
    video.srcObject = null;
  };

  try {
    await video.play();
    const detector = await nativeDetector(environment.BarcodeDetector);
    let engine: CameraScanner['engine'];
    let decode: (canvas: HTMLCanvasElement) => Promise<string[]>;
    if (detector) {
      engine = 'native';
      decode = async (canvas) => (await detector.detect(canvas)).map((code) => code.rawValue);
    } else {
      engine = 'zxing';
      const decodeWithZxing = (await environment.loadZxing()).createZxingDecoder();
      decode = async (canvas) => {
        const code = decodeWithZxing(canvas);
        return code === null ? [] : [code];
      };
    }

    const canvas = environment.createCanvas();
    let running = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const detect = async () => {
      if (!running) return;
      try {
        if (captureFrame(video, canvas, options.frame?.() ?? null)) {
          for (const code of await decode(canvas)) if (running) onCode(code);
        }
      } catch {
        // A frame that could not be analysed; try the next one.
      }
      if (running) timer = setTimeout(() => void detect(), DETECT_INTERVAL_MS);
    };
    void detect();
    return {
      engine,
      stop: () => {
        running = false;
        clearTimeout(timer);
        stopStream();
      },
    };
  } catch (error) {
    stopStream();
    throw error instanceof CameraError ? error : cameraError(error);
  }
}
