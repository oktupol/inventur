import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CameraError,
  startCamera,
  type CameraEnvironment,
  type DetectorConstructor,
} from './camera.ts';

afterEach(() => vi.useRealTimers());

function fakeStream() {
  const track = { stop: vi.fn() };
  return { stream: { getTracks: () => [track] } as unknown as MediaStream, track };
}

function fakeVideo() {
  const video = document.createElement('video');
  video.play = vi.fn().mockResolvedValue(undefined);
  return video;
}

function environment(overrides: Partial<CameraEnvironment> = {}) {
  const { stream, track } = fakeStream();
  const getUserMedia = vi.fn().mockResolvedValue(stream);
  const zxingStop = vi.fn();
  const decodeWithZxing = vi.fn(async (_video: HTMLVideoElement, onCode: (c: string) => void) => {
    onCode('ZX-1');
    return zxingStop;
  });
  const env: CameraEnvironment = {
    mediaDevices: { getUserMedia },
    BarcodeDetector: undefined,
    loadZxing: async () => ({ decodeWithZxing }),
    ...overrides,
  };
  return { env, track, getUserMedia, decodeWithZxing, zxingStop };
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
    const scanner = await startCamera(fakeVideo(), (code) => codes.push(code), env);
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
    (await startCamera(fakeVideo(), () => {}, env)).stop();
    expect(created[0]!.formats).toEqual(['ean_13', 'qr_code']);
  });

  it('falls back to ZXing without BarcodeDetector or without EAN-13 support', async () => {
    for (const BarcodeDetector of [undefined, detectorReturning([], ['qr_code']).Detector]) {
      const { env, decodeWithZxing, zxingStop, track } = environment({ BarcodeDetector });
      const codes: string[] = [];
      const scanner = await startCamera(fakeVideo(), (code) => codes.push(code), env);
      expect(scanner.engine).toBe('zxing');
      expect(decodeWithZxing).toHaveBeenCalled();
      expect(codes).toEqual(['ZX-1']);
      scanner.stop();
      expect(zxingStop).toHaveBeenCalled();
      expect(track.stop).toHaveBeenCalled();
    }
  });

  it('explains a missing secure context', async () => {
    const { env } = environment({ mediaDevices: undefined });
    await expect(startCamera(fakeVideo(), () => {}, env)).rejects.toThrow(/sichere Verbindung/);
  });

  it('explains a denied camera permission', async () => {
    const { env } = environment();
    env.mediaDevices = {
      getUserMedia: vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError')),
    };
    const error = await startCamera(fakeVideo(), () => {}, env).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CameraError);
    expect((error as Error).message).toMatch(/nicht erlaubt/);
  });
});
