import type { ImportResponse } from '@inventur/shared';
import { useState } from 'react';
import { api } from '../api/client.ts';
import { useAction } from '../api/useAction.ts';
import { ErrorNotice, Notice } from '../components/Notice.tsx';

/** Copies records from the previous stocktake and reports how many were added. */
export function ImportButton({ url, noun }: { url: string; noun: [string, string] }) {
  const action = useAction();
  const [result, setResult] = useState<string>();

  async function importRecords() {
    setResult(undefined);
    await action.run(async () => {
      const response = await api.post<ImportResponse<unknown>>(url);
      const count = response.created.length;
      setResult(
        count === 0
          ? `Aus „${response.source.name}“ wurde nichts übernommen, alle Namen sind schon vorhanden.`
          : `${count} ${count === 1 ? noun[0] : noun[1]} aus „${response.source.name}“ übernommen.`,
      );
    });
  }

  return (
    <div>
      <button type="button" disabled={action.busy} onClick={() => void importRecords()}>
        Aus letzter Inventur übernehmen
      </button>
      {(result || action.error) && (
        <div style={{ marginTop: '0.75rem' }}>
          {result && <Notice kind="success">{result}</Notice>}
          <ErrorNotice error={action.error} />
        </div>
      )}
    </div>
  );
}
