import { ConnectionIndicator } from '../realtime/ConnectionIndicator.tsx';

export function ScanPage() {
  return (
    <main style={{ padding: '1rem' }}>
      <ConnectionIndicator />
      <h1>Handy-Scanner</h1>
    </main>
  );
}
