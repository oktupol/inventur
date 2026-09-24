import type { ConnectionStatus } from '@inventur/shared';
import { useConnectionStatus } from './RealtimeProvider.tsx';

const LABELS: Record<ConnectionStatus, string> = {
  open: 'Verbunden',
  connecting: 'Verbindung wird hergestellt …',
  closed: 'Keine Verbindung zum Server',
};

const COLORS: Record<ConnectionStatus, string> = {
  open: '#1a7f37',
  connecting: '#9a6700',
  closed: '#cf222e',
};

export function ConnectionIndicator() {
  const status = useConnectionStatus();
  return (
    <div
      role="status"
      data-status={status}
      style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4em' }}
    >
      <span
        aria-hidden
        style={{
          width: '0.7em',
          height: '0.7em',
          borderRadius: '50%',
          background: COLORS[status],
        }}
      />
      {LABELS[status]}
    </div>
  );
}
