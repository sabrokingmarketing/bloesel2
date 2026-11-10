import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { checkAdminSession, useAdmin, useAdminSync } from '../../data/store';
import { AdminLayout } from './AdminLayout';
import { AdminLogin } from './AdminLogin';
import { Customers } from './Customers';
import { Dashboard } from './Dashboard';
import { QRCodes } from './QRCodes';
import { Scan } from './Scan';
import { SettingsPage } from './Settings';

export default function AdminRoutes() {
  const admin = useAdmin();
  useEffect(() => {
    void checkAdminSession();
  }, []);
  useAdminSync(10_000);

  if (admin.auth === 'unknown') return <div className="page-loading" aria-label="Loading" />;
  if (admin.auth === 'out') return <AdminLogin />;
  if (!admin.db) return <div className="page-loading" aria-label="Loading" />;
  return (
    <Routes>
      <Route element={<AdminLayout />}>
        <Route index element={<Dashboard />} />
        <Route path="scan" element={<Scan />} />
        <Route path="customers" element={<Customers />} />
        <Route path="qr-codes" element={<QRCodes />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Route>
    </Routes>
  );
}
