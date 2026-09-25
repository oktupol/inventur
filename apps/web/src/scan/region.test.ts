import { describe, expect, it } from 'vitest';
import { frameToVideoRegion, QUIET_ZONE_MARGIN } from './region.ts';

describe('frameToVideoRegion', () => {
  it('maps the frame one to one when video and element have the same size', () => {
    const region = frameToVideoRegion(
      { width: 1000, height: 1000 },
      { width: 1000, height: 1000 },
      { x: 100, y: 200, width: 800, height: 300 },
    );
    const margin = 800 * QUIET_ZONE_MARGIN;
    expect(region).toEqual({ x: 100 - margin, y: 200, width: 800 + 2 * margin, height: 300 });
  });

  it('accounts for the cropped sides of a landscape video in a portrait element', () => {
    // 1280×720 scaled by 2 to fill 900×1440: 1660 px wider, 830 px cut off per side.
    const region = frameToVideoRegion(
      { width: 1280, height: 720 },
      { width: 900, height: 1440 },
      { x: 100, y: 300, width: 700, height: 400 },
    );
    const margin = 700 * QUIET_ZONE_MARGIN;
    expect(region).toEqual({
      x: Math.floor((100 - margin + 830) / 2),
      y: 150,
      width: Math.ceil((800 + margin + 830) / 2) - Math.floor((100 - margin + 830) / 2),
      height: 200,
    });
  });

  it('accounts for the cropped top and bottom of a portrait video in a wide element', () => {
    // 480×640 scaled by 2 to fill 960×600: 680 px taller, 340 px cut off at the top.
    const region = frameToVideoRegion(
      { width: 480, height: 640 },
      { width: 960, height: 600 },
      { x: 400, y: 100, width: 100, height: 200 },
    );
    expect(region?.y).toBe(220);
    expect(region?.height).toBe(100);
  });

  it('clamps the widened frame to the picture', () => {
    const region = frameToVideoRegion(
      { width: 1000, height: 1000 },
      { width: 1000, height: 1000 },
      { x: 0, y: 0, width: 1000, height: 1000 },
    );
    expect(region).toEqual({ x: 0, y: 0, width: 1000, height: 1000 });
  });

  it('returns null without known sizes or for a frame outside the picture', () => {
    const frame = { x: 10, y: 10, width: 100, height: 100 };
    expect(frameToVideoRegion({ width: 0, height: 0 }, { width: 500, height: 500 }, frame)).toBe(
      null,
    );
    expect(frameToVideoRegion({ width: 500, height: 500 }, { width: 0, height: 0 }, frame)).toBe(
      null,
    );
    expect(
      frameToVideoRegion(
        { width: 500, height: 500 },
        { width: 500, height: 500 },
        { x: 600, y: 600, width: 100, height: 100 },
      ),
    ).toBe(null);
  });
});
