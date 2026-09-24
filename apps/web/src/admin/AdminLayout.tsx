import { NavLink, Outlet } from 'react-router';
import { ConnectionIndicator } from '../realtime/ConnectionIndicator.tsx';
import { ActiveStocktakeProvider, useActiveStocktake } from './ActiveStocktake.tsx';

function Navigation() {
  const { stocktake } = useActiveStocktake();
  return (
    <nav className="admin-nav" aria-label="Admin-Navigation">
      <div className="brand">
        Inventur-Admin
        <span className="stocktake-name">
          {stocktake === undefined ? '' : (stocktake?.name ?? 'Keine aktive Inventur')}
        </span>
      </div>
      <NavLink to="/admin" end>
        Inventur
      </NavLink>
      <NavLink to="/admin/mitarbeiter">Mitarbeiter</NavLink>
      <NavLink to="/admin/bereiche">Arbeitsbereiche</NavLink>
      <NavLink to="/admin/stationen">Arbeitsstationen</NavLink>
      <NavLink to="/admin/historie">Historie</NavLink>
      <div className="spacer" />
      <ConnectionIndicator />
    </nav>
  );
}

export function AdminLayout() {
  return (
    <ActiveStocktakeProvider>
      <div className="admin">
        <Navigation />
        <main className="admin-main">
          <Outlet />
        </main>
      </div>
    </ActiveStocktakeProvider>
  );
}
