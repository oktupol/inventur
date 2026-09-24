import type { PairResponse } from '@inventur/shared';
import { useState, type FormEvent } from 'react';
import { api } from '../api/client.ts';
import { useAction } from '../api/useAction.ts';
import { ErrorNotice, Notice } from '../components/Notice.tsx';

/** Pairing with the six-digit code shown at the workstation. */
export function PairForm({
  onPaired,
  notice,
}: {
  onPaired: (response: PairResponse) => void;
  notice?: string;
}) {
  const [code, setCode] = useState('');
  const action = useAction();
  const digits = code.replace(/\D/g, '');

  async function submit(event: FormEvent) {
    event.preventDefault();
    await action.run(async () =>
      onPaired(await api.post<PairResponse>('/api/scan/pair', { code: digits })),
    );
  }

  return (
    <div className="scan-page">
      <h1>Handy-Scanner</h1>
      {notice && <Notice kind="warning">{notice}</Notice>}
      <p>
        An der Arbeitsstation auf <strong>„Handy koppeln“</strong> tippen und entweder den QR-Code
        mit der Kamera scannen oder hier den sechsstelligen Code eingeben.
      </p>
      <form onSubmit={(e) => void submit(e)} className="pair-form">
        <label htmlFor="pair-code">Code von der Station</label>
        <input
          id="pair-code"
          value={code}
          onChange={(event) => {
            setCode(event.target.value);
            action.clearError();
          }}
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="123 456"
          maxLength={7}
        />
        <button type="submit" className="primary" disabled={action.busy || digits.length !== 6}>
          Koppeln
        </button>
      </form>
      <ErrorNotice error={action.error} />
    </div>
  );
}
