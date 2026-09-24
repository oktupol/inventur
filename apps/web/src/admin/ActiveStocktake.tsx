import type { ActiveStocktakeResponse, Stocktake } from '@inventur/shared';
import { createContext, useContext, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useApiData } from '../api/useApiData.ts';

export interface ActiveStocktakeState {
  /** undefined while loading, null without an active stocktake. */
  stocktake: Stocktake | null | undefined;
  reload: () => void;
}

const ActiveStocktakeContext = createContext<ActiveStocktakeState>({
  stocktake: undefined,
  reload: () => {},
});

export function ActiveStocktakeProvider({ children }: { children: ReactNode }) {
  const { data, reload } = useApiData<ActiveStocktakeResponse>('/api/admin/stocktakes/active', {
    channels: ['admin'],
    filter: (event) => event.type === 'stocktake.changed',
  });
  return (
    <ActiveStocktakeContext.Provider value={{ stocktake: data?.stocktake, reload }}>
      {children}
    </ActiveStocktakeContext.Provider>
  );
}

export function useActiveStocktake(): ActiveStocktakeState {
  return useContext(ActiveStocktakeContext);
}

/** Hint for pages that need an active stocktake. */
export function NoActiveStocktake() {
  return (
    <div className="card">
      <p>Es läuft keine Inventur.</p>
      <Link to="/admin">Neue Inventur starten</Link>
    </div>
  );
}
