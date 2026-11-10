import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Landing } from './pages/Landing';
import { CustomerLayout } from './pages/customer/CustomerLayout';
import { Join } from './pages/customer/Join';
import { Claim } from './pages/customer/Claim';
import { CounterStamp } from './pages/customer/CounterStamp';
import { Home } from './pages/customer/Home';
import { QRPage } from './pages/customer/QRPage';
import { Rewards } from './pages/customer/Rewards';
import { History } from './pages/customer/History';
import { Profile } from './pages/customer/Profile';

// The staff portal is code-split so customers never download it.
const AdminRoutes = lazy(() => import('./pages/admin/AdminRoutes'));

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/app/join" element={<Join />} />
      <Route path="/app/claim" element={<Claim />} />
      <Route path="/app/stamp" element={<CounterStamp />} />
      <Route path="/app/qr" element={<QRPage />} />
      <Route path="/app" element={<CustomerLayout />}>
        <Route index element={<Home />} />
        <Route path="rewards" element={<Rewards />} />
        <Route path="history" element={<History />} />
        <Route path="profile" element={<Profile />} />
      </Route>
      <Route
        path="/admin/*"
        element={
          <Suspense fallback={<div className="page-loading" aria-label="Loading" />}>
            <AdminRoutes />
          </Suspense>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
