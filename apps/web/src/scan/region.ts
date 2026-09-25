export interface Size {
  width: number;
  height: number;
}

export interface Rect extends Size {
  x: number;
  y: number;
}

/**
 * Horizontal widening of the frame, as a share of its width, so a barcode
 * that fills the frame keeps the quiet zones the decoders need. There is no
 * vertical widening: one row through a 1D barcode suffices to read it, so a
 * neighbouring label above or below would otherwise be read.
 */
export const QUIET_ZONE_MARGIN = 0.08;

/**
 * Maps the scan frame shown over the video (in element pixels) to the part of
 * the camera picture below it (in video pixels). The video is displayed with
 * `object-fit: cover`: scaled to fill the element, centred and cropped.
 * Returns null if the sizes are not known yet or the frame lies outside.
 */
export function frameToVideoRegion(video: Size, element: Size, frame: Rect): Rect | null {
  if (video.width <= 0 || video.height <= 0 || element.width <= 0 || element.height <= 0) {
    return null;
  }
  const scale = Math.max(element.width / video.width, element.height / video.height);
  const offsetX = (element.width - video.width * scale) / 2;
  const offsetY = (element.height - video.height * scale) / 2;
  const margin = frame.width * QUIET_ZONE_MARGIN;
  const left = Math.max(0, (frame.x - margin - offsetX) / scale);
  const top = Math.max(0, (frame.y - offsetY) / scale);
  const right = Math.min(video.width, (frame.x + frame.width + margin - offsetX) / scale);
  const bottom = Math.min(video.height, (frame.y + frame.height - offsetY) / scale);
  if (right - left < 1 || bottom - top < 1) return null;
  const x = Math.floor(left);
  const y = Math.floor(top);
  return { x, y, width: Math.ceil(right) - x, height: Math.ceil(bottom) - y };
}
