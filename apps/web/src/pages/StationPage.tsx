import { ConnectionIndicator } from '../realtime/ConnectionIndicator.tsx';

export function StationPage() {
  return (
    <main style={{ padding: '1rem' }}>
      <ConnectionIndicator />
      <h1>Arbeitsstation</h1>
    </main>
  );
}
