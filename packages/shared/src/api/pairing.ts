import type { NamedRef } from './common.ts';

/** Header with which a paired phone authenticates its requests to `/api/scan/*`. */
export const DEVICE_TOKEN_HEADER = 'x-device-token';

/** A pairing code and QR code stay valid for this long and can be used once. */
export const PAIRING_VALIDITY_MS = 5 * 60 * 1000;

/** `POST /api/station/pairings`: what the workstation shows to pair a phone. */
export interface PairingOffer {
  id: number;
  /** Six digits, entered on the phone at `scanUrl`. */
  code: string;
  /** Page to open on the phone, e.g. `https://192.168.1.10/scan`. */
  scanUrl: string;
  /** QR code (SVG) with `scanUrl` and a one-time token, pairs without typing the code. */
  qrSvg: string;
  /** Instructions for installing the certificate, over plain HTTP. */
  certificateUrl: string;
  certificateQrSvg: string;
  validUntil: string;
}

/** A phone paired with a workstation. */
export interface PairedDevice {
  id: number;
  /** Kind of device derived from the browser, e.g. "iPhone". */
  label: string;
  pairedAt: string;
}

/** `POST /api/scan/pair`: either the six-digit code or the token from the QR code. */
export interface PairRequest {
  code?: string;
  qrToken?: string;
}

export interface PairResponse {
  /** Secret the phone stores and sends in `x-device-token`. */
  deviceToken: string;
  workstation: NamedRef;
}
