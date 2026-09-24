import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CertificatePage } from './CertificatePage.tsx';

afterEach(cleanup);

describe('CertificatePage', () => {
  it('offers the CA certificate and links to the HTTPS scanner page of this host', () => {
    render(<CertificatePage />);
    const download = screen.getByRole('link', { name: 'Zertifikat herunterladen' });
    expect(download.getAttribute('href')).toBe('/ca.crt');
    const check = screen.getByRole('link', { name: `https://${window.location.hostname}/scan` });
    expect(check.getAttribute('href')).toBe(`https://${window.location.hostname}/scan`);
  });

  it('explains the steps for iPhone and Android', () => {
    render(<CertificatePage />);
    expect(screen.getByRole('heading', { name: 'iPhone und iPad' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Android' })).toBeTruthy();
    expect(screen.getAllByText(/Zertifikatsvertrauenseinstellungen/).length).toBeGreaterThan(0);
  });
});
