import { Route, Routes } from 'react-router';
import { AdminPage } from './pages/AdminPage.tsx';
import { NotFoundPage } from './pages/NotFoundPage.tsx';
import { ScanPage } from './pages/ScanPage.tsx';
import { StationPage } from './pages/StationPage.tsx';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<StationPage />} />
      <Route path="/admin/*" element={<AdminPage />} />
      <Route path="/scan" element={<ScanPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
