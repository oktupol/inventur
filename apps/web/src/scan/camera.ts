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

interface DetectedBarcode {
  rawValue: string;
}

interface Detector {
  detect(source: HTMLVideoElement): Promise<DetectedBarcode[]>;
}

export interface DetectorConstructor {
  new (options: { formats: string[] }): Detector;
  getSupportedFormats?(): Promise<string[]>;
}

export interface CameraEnvironment {
  mediaDevices: Pick<MediaDevices, 'getUserMedia'> | undefined;
  BarcodeDetector: DetectorConstructor | undefined;
  loadZxing: () => Promise<{
    decodeWithZxing: (
      video: HTMLVideoElement,
      onCode: (code: string) => void,
    ) => Promise<() => void>;
  }>;
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

/** Pause between two detection attempts of the native detector. */
const DETECT_INTERVAL_MS = 120;

function defaultEnvironment(): CameraEnvironment {
  return {
    mediaDevices: navigator.mediaDevices,
    BarcodeDetector: (globalThis as { BarcodeDetector?: DetectorConstructor }).BarcodeDetector,
    loadZxing: () => import('./zxing.ts'),
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
 * Starts the rear camera in `video` and reports every detected code. Uses the
 * BarcodeDetector API where available and ZXing otherwise.
 */
export async function startCamera(
  video: HTMLVideoElement,
  onCode: (code: string) => void,
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
    if (detector) {
      let running = true;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const detect = async () => {
        if (!running) return;
        try {
          for (const barcode of await detector.detect(video)) onCode(barcode.rawValue);
        } catch {
          // A frame that could not be analysed; try the next one.
        }
        if (running) timer = setTimeout(() => void detect(), DETECT_INTERVAL_MS);
      };
      void detect();
      return {
        engine: 'native',
        stop: () => {
          running = false;
          clearTimeout(timer);
          stopStream();
        },
      };
    }
    const { decodeWithZxing } = await environment.loadZxing();
    const stopDecoding = await decodeWithZxing(video, onCode);
    return {
      engine: 'zxing',
      stop: () => {
        stopDecoding();
        stopStream();
      },
    };
  } catch (error) {
    stopStream();
    throw error instanceof CameraError ? error : cameraError(error);
  }
}
