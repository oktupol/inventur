import type { Stocktake, UnclosedWorkAreasDetails, WorkArea } from '@inventur/shared';
import { useState } from 'react';
import { api, ApiRequestError } from '../api/client.ts';
import { ConfirmDialog } from '../components/Dialog.tsx';
import { ErrorNotice } from '../components/Notice.tsx';
import { WORK_AREA_STATUS_LABELS } from '../format.ts';

type Unclosed = UnclosedWorkAreasDetails['workAreas'];

export interface FinishStocktakeDialogProps {
  stocktake: Stocktake;
  /** Current work areas, used to warn about unclosed ones before asking the server. */
  workAreas: readonly WorkArea[];
  onFinished: () => void;
  onCancel: () => void;
}

/**
 * Confirms finishing the stocktake and warns about work areas that are not
 * closed. If the server knows of further unclosed areas, the list is updated
 * and the administrator has to confirm again.
 */
export function FinishStocktakeDialog({
  stocktake,
  workAreas,
  onFinished,
  onCancel,
}: FinishStocktakeDialogProps) {
  const [unclosed, setUnclosed] = useState<Unclosed>(() =>
    workAreas
      .filter((area) => area.status !== 'closed')
      .map(({ id, name, status }) => ({ id, name, status: status as Unclosed[number]['status'] })),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiRequestError>();

  async function finish() {
    setBusy(true);
    setError(undefined);
    try {
      await api.post(`/api/admin/stocktakes/${stocktake.id}/finish`, {
        confirm: unclosed.length > 0,
      });
      onFinished();
    } catch (e) {
      if (e instanceof ApiRequestError && e.code === 'unclosed_work_areas') {
        setUnclosed((e.details as UnclosedWorkAreasDetails).workAreas);
      } else {
        setError(e instanceof ApiRequestError ? e : new ApiRequestError('internal_error', 0));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <ConfirmDialog
      title="Inventur beenden"
      confirmLabel={unclosed.length > 0 ? 'Trotzdem beenden' : 'Inventur beenden'}
      danger
      busy={busy}
      onConfirm={() => void finish()}
      onCancel={onCancel}
    >
      <p>
        Soll die Inventur <strong>{stocktake.name}</strong> beendet werden? Danach kann nichts mehr
        erfasst oder geändert werden. Alle Stationen zeigen „Keine aktive Inventur“, und gekoppelte
        Handys werden getrennt.
      </p>
      {unclosed.length > 0 && (
        <div className="notice warning" role="alert">
          <p style={{ marginTop: 0 }}>
            {unclosed.length === 1
              ? 'Ein Arbeitsbereich ist noch nicht abgeschlossen:'
              : `${unclosed.length} Arbeitsbereiche sind noch nicht abgeschlossen:`}
          </p>
          <ul style={{ marginBottom: 0 }}>
            {unclosed.map((area) => (
              <li key={area.id}>
                {area.name} ({WORK_AREA_STATUS_LABELS[area.status]})
              </li>
            ))}
          </ul>
        </div>
      )}
      <ErrorNotice error={error} />
    </ConfirmDialog>
  );
}
