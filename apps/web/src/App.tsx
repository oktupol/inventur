import { Route, Routes } from 'react-router';
import { AdminPage } from './pages/AdminPage.tsx';
import { NotFoundPage } from './pages/NotFoundPage.tsx';
import { ScanPage } from './pages/ScanPage.tsx';
import { StationPage } from './pages/StationPage.tsx';
import { ConnectionIndicator } from './realtime/ConnectionIndicator.tsx';

export function App() {
  return (
    <>
      <header style={{ display: 'flex', justifyContent: 'flex-end', padding: '0.5rem 1rem' }}>
        <ConnectionIndicator />
      </header>
      <Routes>
        <Route path="/" element={<StationPage />} />
        <Route path="/admin/*" element={<AdminPage />} />
        <Route path="/scan" element={<ScanPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </>
  );
}
