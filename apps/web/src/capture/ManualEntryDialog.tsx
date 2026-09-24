import { parsePrice } from '@inventur/shared';
import { useState, type FormEvent } from 'react';
import { Dialog } from '../components/Dialog.tsx';

export interface ManualEntryValues {
  description: string;
  priceGross: string;
  serialNumber: string | null;
}

export interface ManualEntryDialogProps {
  /** The original input, e.g. the unknown scanned code; stored with the line. */
  input: string;
  onSubmit: (values: ManualEntryValues) => void;
  onCancel: () => void;
}

/**
 * Form for an article that is not in the master data: description and gross
 * price are required, the serial number is optional. There is no net price
 * and no category.
 */
export function ManualEntryDialog({ input, onSubmit, onCancel }: ManualEntryDialogProps) {
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [error, setError] = useState<string>();

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (description.trim() === '') return setError('Bitte eine Bezeichnung eingeben.');
    const priceGross = parsePrice(price);
    if (priceGross === null) {
      return setError('Bitte einen Bruttopreis größer als 0 eingeben, z. B. 129,90.');
    }
    onSubmit({
      description: description.trim(),
      priceGross,
      serialNumber: serialNumber.trim() || null,
    });
  }

  return (
    <Dialog
      title="Manuell erfassen"
      onClose={onCancel}
      actions={
        <>
          <button type="button" onClick={onCancel}>
            Abbrechen
          </button>
          <button type="submit" form="manual-entry" className="primary">
            Erfassen
          </button>
        </>
      }
    >
      {input !== '' && (
        <p>
          Eingabe: <span className="code">{input}</span>
        </p>
      )}
      <form id="manual-entry" className="manual-form" onSubmit={submit}>
        <label>
          Bezeichnung
          <input
            value={description}
            onChange={(event) => {
              setDescription(event.target.value);
              setError(undefined);
            }}
            maxLength={200}
          />
        </label>
        <label>
          Bruttopreis in €
          <input
            value={price}
            inputMode="decimal"
            onChange={(event) => {
              setPrice(event.target.value);
              setError(undefined);
            }}
          />
        </label>
        <label>
          Seriennummer (optional)
          <input
            value={serialNumber}
            onChange={(event) => setSerialNumber(event.target.value)}
            maxLength={100}
          />
        </label>
        {/* Enter in any field submits the form. */}
        <button type="submit" hidden />
      </form>
      {error && (
        <div className="notice error" role="alert" style={{ marginTop: '0.75rem' }}>
          {error}
        </div>
      )}
      <p className="muted" style={{ marginBottom: 0 }}>
        Die Zeile wird als „manuell“ markiert. Nettopreis und Kategorie bleiben leer.
      </p>
    </Dialog>
  );
}
