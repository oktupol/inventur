import { Route, Routes } from 'react-router';
import { AdminLayout } from '../admin/AdminLayout.tsx';
import { AuditLogPage, StocktakeAuditLogPage } from '../admin/AuditLogPage.tsx';
import { EmployeesPage } from '../admin/EmployeesPage.tsx';
import { HistoryPage, StocktakeDetailPage } from '../admin/HistoryPage.tsx';
import { StatisticsPage, StocktakeStatisticsPage } from '../admin/StatisticsPage.tsx';
import { StocktakePage } from '../admin/StocktakePage.tsx';
import { WorkAreasPage } from '../admin/WorkAreasPage.tsx';
import { WorkstationsPage } from '../admin/WorkstationsPage.tsx';
import { NotFoundPage } from './NotFoundPage.tsx';

export function AdminPage() {
  return (
    <Routes>
      <Route element={<AdminLayout />}>
        <Route index element={<StocktakePage />} />
        <Route path="mitarbeiter" element={<EmployeesPage />} />
        <Route path="bereiche" element={<WorkAreasPage />} />
        <Route path="stationen" element={<WorkstationsPage />} />
        <Route path="historie" element={<HistoryPage />} />
        <Route path="statistik" element={<StatisticsPage />} />
        <Route path="protokoll" element={<AuditLogPage />} />
        <Route path="historie/:id" element={<StocktakeDetailPage />} />
        <Route path="historie/:id/statistik" element={<StocktakeStatisticsPage />} />
        <Route path="historie/:id/protokoll" element={<StocktakeAuditLogPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
