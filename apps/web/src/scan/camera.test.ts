import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CameraError,
  startCamera,
  type CameraEnvironment,
  type DetectorConstructor,
} from './camera.ts';
import { frameToVideoRegion } from './region.ts';

afterEach(() => vi.useRealTimers());

function fakeStream() {
  const track = { stop: vi.fn() };
  return { stream: { getTracks: () => [track] } as unknown as MediaStream, track };
}

function fakeVideo(picture = { width: 1000, height: 1000 }, element = picture) {
  const video = document.createElement('video');
  video.play = vi.fn().mockResolvedValue(undefined);
  Object.defineProperties(video, {
    videoWidth: { value: picture.width },
    videoHeight: { value: picture.height },
    clientWidth: { value: element.width },
    clientHeight: { value: element.height },
  });
  return video;
}

function fakeCanvas() {
  const drawImage = vi.fn();
  const canvas = { width: 0, height: 0, getContext: () => ({ drawImage }) };
  return { canvas: canvas as unknown as HTMLCanvasElement, drawImage };
}

function environment(overrides: Partial<CameraEnvironment> = {}) {
  const { stream, track } = fakeStream();
  const getUserMedia = vi.fn().mockResolvedValue(stream);
  const zxingCodes = ['ZX-1'];
  const decodeWithZxing = vi.fn(() => zxingCodes.shift() ?? null);
  const { canvas, drawImage } = fakeCanvas();
  const env: CameraEnvironment = {
    mediaDevices: { getUserMedia },
    BarcodeDetector: undefined,
    loadZxing: async () => ({ createZxingDecoder: () => decodeWithZxing }),
    createCanvas: () => canvas,
    ...overrides,
  };
  return { env, track, getUserMedia, decodeWithZxing, canvas, drawImage };
}

function detectorReturning(codes: string[][], supported?: string[]) {
  const created: { formats: string[] }[] = [];
  class FakeDetector {
    constructor(options: { formats: string[] }) {
      created.push(options);
    }
    static getSupportedFormats = supported ? async () => supported : undefined;
    async detect() {
      return (codes.shift() ?? []).map((rawValue) => ({ rawValue }));
    }
  }
  return { Detector: FakeDetector as unknown as DetectorConstructor, created };
}

describe('startCamera', () => {
  it('uses the rear camera and the BarcodeDetector API when available', async () => {
    vi.useFakeTimers();
    const { Detector, created } = detectorReturning([['4006381333931'], [], ['4006381333931']]);
    const { env, getUserMedia, track } = environment({ BarcodeDetector: Detector });
    const codes: string[] = [];
    const scanner = await startCamera(fakeVideo(), (code) => codes.push(code), {}, env);
    expect(scanner.engine).toBe('native');
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: false,
      video: { facingMode: { ideal: 'environment' } },
    });
    expect(created[0]!.formats).toEqual([
      'ean_13',
      'ean_8',
      'upc_a',
      'upc_e',
      'code_128',
      'code_39',
      'qr_code',
    ]);
    await vi.advanceTimersByTimeAsync(500);
    expect(codes).toEqual(['4006381333931', '4006381333931']);

    scanner.stop();
    expect(track.stop).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(codes).toHaveLength(2);
  });

  it('asks the detector only for supported formats', async () => {
    const { Detector, created } = detectorReturning([], ['ean_13', 'qr_code', 'aztec']);
    const { env } = environment({ BarcodeDetector: Detector });
    (await startCamera(fakeVideo(), () => {}, {}, env)).stop();
    expect(created[0]!.formats).toEqual(['ean_13', 'qr_code']);
  });

  it('reads only the part of the picture below the scan frame', async () => {
    const { Detector } = detectorReturning([]);
    const { env, canvas, drawImage } = environment({ BarcodeDetector: Detector });
    // 1280×720 scaled by 2 to fill 900×1440, 830 px cut off on either side.
    const video = fakeVideo({ width: 1280, height: 720 }, { width: 900, height: 1440 });
    const frame = { x: 70, y: 300, width: 760, height: 400 };
    const scanner = await startCamera(video, () => {}, { frame: () => frame }, env);
    scanner.stop();
    const region = frameToVideoRegion(
      { width: 1280, height: 720 },
      { width: 900, height: 1440 },
      frame,
    )!;
    expect(region.y).toBe(150);
    expect(region.height).toBe(200);
    expect(drawImage).toHaveBeenCalledWith(
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
    expect([canvas.width, canvas.height]).toEqual([region.width, region.height]);
  });

  it('reads the whole picture without a scan frame', async () => {
    const { Detector } = detectorReturning([]);
    const { env, drawImage } = environment({ BarcodeDetector: Detector });
    const video = fakeVideo({ width: 640, height: 480 });
    (await startCamera(video, () => {}, {}, env)).stop();
    expect(drawImage).toHaveBeenCalledWith(video, 0, 0, 640, 480, 0, 0, 640, 480);
  });

  it('waits for the first picture of the camera', async () => {
    vi.useFakeTimers();
    const { Detector } = detectorReturning([['4006381333931']]);
    const { env, drawImage } = environment({ BarcodeDetector: Detector });
    const codes: string[] = [];
    const video = fakeVideo({ width: 0, height: 0 }, { width: 900, height: 1440 });
    const scanner = await startCamera(
      video,
      (code) => codes.push(code),
      { frame: () => ({ x: 0, y: 0, width: 100, height: 100 }) },
      env,
    );
    await vi.advanceTimersByTimeAsync(500);
    expect(drawImage).not.toHaveBeenCalled();
    expect(codes).toEqual([]);
    scanner.stop();
  });

  it('falls back to ZXing without BarcodeDetector or without EAN-13 support', async () => {
    for (const BarcodeDetector of [undefined, detectorReturning([], ['qr_code']).Detector]) {
      const { env, decodeWithZxing, canvas, track } = environment({ BarcodeDetector });
      const codes: string[] = [];
      const scanner = await startCamera(fakeVideo(), (code) => codes.push(code), {}, env);
      expect(scanner.engine).toBe('zxing');
      await vi.waitFor(() => expect(codes).toEqual(['ZX-1']));
      expect(decodeWithZxing).toHaveBeenCalledWith(canvas);
      scanner.stop();
      expect(track.stop).toHaveBeenCalled();
    }
  });

  it('explains a missing secure context', async () => {
    const { env } = environment({ mediaDevices: undefined });
    await expect(startCamera(fakeVideo(), () => {}, {}, env)).rejects.toThrow(/sichere Verbindung/);
  });

  it('explains a denied camera permission', async () => {
    const { env } = environment();
    env.mediaDevices = {
      getUserMedia: vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError')),
    };
    const error = await startCamera(fakeVideo(), () => {}, {}, env).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CameraError);
    expect((error as Error).message).toMatch(/nicht erlaubt/);
  });
});
