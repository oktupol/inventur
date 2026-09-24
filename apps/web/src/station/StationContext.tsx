import type { StationState } from '@inventur/shared';
import { createContext, useContext } from 'react';
import type { Api } from '../api/client.ts';

export interface Station {
  /** API requests authenticated with the workstation token. */
  api: Api;
  headers: Record<string, string>;
  state: StationState;
  reload: () => void;
}

export const StationContext = createContext<Station | null>(null);

export function useStation(): Station {
  const station = useContext(StationContext);
  if (!station) throw new Error('useStation requires a registered workstation');
  return station;
}
