import type { Employee } from '@inventur/shared';
import { useState, type FormEvent } from 'react';
import { api } from '../api/client.ts';
import { useAction } from '../api/useAction.ts';
import { useApiData } from '../api/useApiData.ts';
import { ConfirmDialog } from '../components/Dialog.tsx';
import { ErrorNotice } from '../components/Notice.tsx';
import { formatNumber } from '../format.ts';
import { NoActiveStocktake, useActiveStocktake } from './ActiveStocktake.tsx';
import { ImportButton } from './ImportButton.tsx';

export interface EmployeeTableProps {
  employees: readonly Employee[];
  onLogout?: (employee: Employee) => void;
  onDelete?: (employee: Employee) => void;
}

export function EmployeeTable({ employees, onLogout, onDelete }: EmployeeTableProps) {
  if (employees.length === 0) return <p className="muted">Noch keine Mitarbeiter.</p>;
  const editable = onLogout !== undefined || onDelete !== undefined;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Arbeitsstation</th>
            <th className="number">Erfassungen</th>
            {editable && <th />}
          </tr>
        </thead>
        <tbody>
          {employees.map((employee) => (
            <tr key={employee.id}>
              <td>{employee.name}</td>
              <td>
                {employee.workstation?.name ?? <span className="muted">nicht angemeldet</span>}
              </td>
              <td className="number">{formatNumber(employee.entryCount)}</td>
              {editable && (
                <td className="actions">
                  {onLogout && employee.workstation && (
                    <button type="button" className="small" onClick={() => onLogout(employee)}>
                      Abmelden
                    </button>
                  )}
                  {onDelete && (
                    <button
                      type="button"
                      className="small"
                      disabled={employee.entryCount > 0}
                      title={
                        employee.entryCount > 0
                          ? 'Mitarbeiter mit Erfassungen können nicht entfernt werden.'
                          : undefined
                      }
                      onClick={() => onDelete(employee)}
                    >
                      Entfernen
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ManageEmployees({ stocktakeId }: { stocktakeId: number }) {
  const url = `/api/admin/stocktakes/${stocktakeId}/employees`;
  const employees = useApiData<Employee[]>(url, { channels: ['admin'] });
  const [name, setName] = useState('');
  const create = useAction();
  const change = useAction();
  const [deleting, setDeleting] = useState<Employee>();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (await create.run(() => api.post(url, { name }))) {
      setName('');
      employees.reload();
    }
  }

  async function logout(employee: Employee) {
    if (await change.run(() => api.post(`${url}/${employee.id}/logout`))) employees.reload();
  }

  async function remove(employee: Employee) {
    const ok = await change.run(() => api.delete(`${url}/${employee.id}`));
    setDeleting(undefined);
    if (ok) employees.reload();
  }

  return (
    <>
      <div className="card">
        <form className="form-row" onSubmit={(e) => void submit(e)}>
          <label>
            Name
            <input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                create.clearError();
              }}
              placeholder="z. B. Anna Berger"
              size={30}
            />
          </label>
          <button type="submit" className="primary" disabled={create.busy || !name.trim()}>
            Hinzufügen
          </button>
        </form>
        <div style={{ marginTop: '0.75rem' }}>
          <ErrorNotice error={create.error} />
        </div>
        <ImportButton url={`${url}/import`} noun={['Mitarbeiter', 'Mitarbeiter']} />
      </div>
      <div className="card">
        <ErrorNotice error={employees.error ?? change.error} />
        {employees.data && (
          <EmployeeTable
            employees={employees.data}
            onLogout={(employee) => void logout(employee)}
            onDelete={setDeleting}
          />
        )}
      </div>
      {deleting && (
        <ConfirmDialog
          title="Mitarbeiter entfernen"
          confirmLabel="Entfernen"
          danger
          busy={change.busy}
          onConfirm={() => void remove(deleting)}
          onCancel={() => setDeleting(undefined)}
        >
          <p>
            Soll <strong>{deleting.name}</strong> aus der Inventur entfernt werden?
            {deleting.workstation &&
              ` Der Mitarbeiter wird von „${deleting.workstation.name}“ abgemeldet.`}
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}

export function EmployeesPage() {
  const { stocktake } = useActiveStocktake();
  return (
    <>
      <div className="page-header">
        <h1>Mitarbeiter</h1>
      </div>
      {stocktake === null && <NoActiveStocktake />}
      {stocktake && <ManageEmployees stocktakeId={stocktake.id} />}
    </>
  );
}
