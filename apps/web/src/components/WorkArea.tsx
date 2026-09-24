import type { WorkArea } from '@inventur/shared';
import { formatNumber, WORK_AREA_STATUS_LABELS } from '../format.ts';
import { ConfirmDialog } from './Dialog.tsx';

export function WorkAreaStatusBadge({ status }: { status: WorkArea['status'] }) {
  return <span className={`badge ${status}`}>{WORK_AREA_STATUS_LABELS[status]}</span>;
}

/** Safety question before closing a work area, showing the counted quantity. */
export function CloseWorkAreaDialog({
  workArea,
  busy,
  onConfirm,
  onCancel,
}: {
  workArea: WorkArea;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <ConfirmDialog
      title="Arbeitsbereich abschließen"
      confirmLabel="Abschließen"
      busy={busy}
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      <p>
        Ist im Bereich <strong>{workArea.name}</strong> alles erfasst?
      </p>
      <p className="close-count">
        <strong>{formatNumber(workArea.quantity)}</strong> Stück in{' '}
        {formatNumber(workArea.entryCount)} {workArea.entryCount === 1 ? 'Zeile' : 'Zeilen'}
      </p>
      <p className="muted">
        Danach kann im Bereich nicht mehr erfasst werden, und alle Stationen verlassen ihn. Er lässt
        sich jederzeit wieder öffnen.
      </p>
    </ConfirmDialog>
  );
}
