import React from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation, Navigate } from 'react-router-dom';
import { AddressProvider } from './contexts/AddressContext';
import { CartProvider } from './contexts/CartContext';
import { CategoryProvider } from './contexts/CategoryContext';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Home from './pages/Home';
import AboutUs from './pages/AboutUs';
import ContactUs from './pages/ContactUs';
import UserDashboard from './pages/UserDashboard';
import PointsDashboard from './pages/PointsDashboard';
import OrderHistory from './pages/OrderHistory';
import SavedAddresses from './pages/SavedAddresses';
import ManageAccount from './pages/ManageAccount';
import Checkout from './pages/Checkout';
import ScanPay from './pages/ScanPay';
import OrderSuccess from './pages/OrderSuccess';
import OrderFailed from './pages/OrderFailed';
import Login from './pages/Login';
import AdminLogin from './pages/AdminLogin';
import CompleteProfile from './pages/CompleteProfile';
import PWAInstallBanner from './components/PWAInstallBanner';
import { PushNotificationManager } from './components/PushNotificationManager';
import { NativeAppManager } from './components/NativeAppManager';

const PrivacyPolicy = React.lazy(() => import('./pages/PrivacyPolicy'));
const TermsOfService = React.lazy(() => import('./pages/TermsOfService'));
const RefundReplacementPolicy = React.lazy(() => import('./pages/RefundReplacementPolicy'));
const DeliveryPolicy = React.lazy(() => import('./pages/DeliveryPolicy'));
const AdminDashboard = React.lazy(() => import('./pages/AdminDashboard'));
const AdminPoints = React.lazy(() => import('./pages/AdminPoints'));
const AdminVouchers = React.lazy(() => import('./pages/AdminVouchers'));
const AdminCategories = React.lazy(() => import('./pages/AdminCategories'));
const AdminMenu = React.lazy(() => import('./pages/AdminMenu'));
const AdminOrders = React.lazy(() => import('./pages/AdminOrders'));
const AdminCustomers = React.lazy(() => import('./pages/AdminCustomers'));
const AdminDeliveryOptions = React.lazy(() => import('./pages/AdminDeliveryOptions'));
const AdminPaymentOptions = React.lazy(() => import('./pages/AdminPaymentOptions'));
const AdminManageShop = React.lazy(() => import('./pages/AdminManageShop'));
const AdminOrderAlert = React.lazy(() => import('./components/AdminOrderAlert'));

const ScrollToTop = () => {
  const { pathname } = useLocation();
  React.useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
};

const RouteLoadingFallback: React.FC = () => (
  <div className="min-h-screen flex items-center justify-center text-gray-500">Loading...</div>
);

const SuspensePage: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <React.Suspense fallback={<RouteLoadingFallback />}>{children}</React.Suspense>
);

const isAdminSubdomain = (): boolean => {
  const host = window.location.hostname;
  const port = window.location.port;
  return (
    host.startsWith('admin.') ||
    host.startsWith('manage.') ||
    host.includes('admin.takcakap') ||
    port === '5174'
  );
};

const RedirectToAdminSubdomain: React.FC = () => {
  React.useEffect(() => {
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    if (isLocal) {
      window.location.href = 'http://localhost:5174';
    } else {
      window.location.href = 'https://admin.takcakap.com';
    }
  }, []);
  return <div className="min-h-screen flex items-center justify-center text-gray-500">Redirecting to Admin Panel...</div>;
};

const RequireAdminAuth: React.FC<{ children: React.ReactElement }> = ({ children }) => {
  const { isAuthenticated, isLoading, user } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center text-gray-500">Checking session...</div>;
  }
  if (!isAuthenticated) {
    const loginPath = isAdminSubdomain() ? "/login" : "/admin/login";
    return <Navigate to={loginPath} replace state={{ from: location.pathname }} />;
  }
  if (user?.role !== 'admin') {
    return <Navigate to="/" replace />;
  }
  return children;
};

const RequireUserAuth: React.FC<{ children: React.ReactElement; requirePhone?: boolean }> = ({ children, requirePhone = false }) => {
  const { isAuthenticated, isLoading, user } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center text-gray-500">Checking session...</div>;
  }
  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (user?.isSuspended) {
    return <Navigate to="/" replace />;
  }
  if (user?.role === 'admin') {
    return <Navigate to="/admin" replace />;
  }
  if (requirePhone && !String(user?.phoneNumber || '').trim()) {
    return <Navigate to="/complete-profile" replace state={{ from: location.pathname }} />;
  }
  return children;
};

const AdminOrderAlertGate: React.FC = () => {
  const { user, isLoading } = useAuth();
  if (isLoading || user?.role !== 'admin') return null;
  return (
    <SuspensePage>
      <AdminOrderAlert />
    </SuspensePage>
  );
};

const App: React.FC = () => {
  const adminMode = isAdminSubdomain();

  if (adminMode) {
    return (
      <AuthProvider>
        <CategoryProvider>
          <Router>
            <ScrollToTop />
            <AdminOrderAlertGate />
            <NativeAppManager />
            <Routes>
              <Route path="/" element={<RequireAdminAuth><SuspensePage><AdminDashboard /></SuspensePage></RequireAdminAuth>} />
              <Route path="/login" element={<AdminLogin />} />
              <Route path="/admin/login" element={<Navigate to="/login" replace />} />
              <Route path="/manage-shop" element={<RequireAdminAuth><SuspensePage><AdminManageShop /></SuspensePage></RequireAdminAuth>} />
              <Route path="/admin/points" element={<RequireAdminAuth><SuspensePage><AdminPoints /></SuspensePage></RequireAdminAuth>} />
              <Route path="/admin/vouchers" element={<RequireAdminAuth><SuspensePage><AdminVouchers /></SuspensePage></RequireAdminAuth>} />
              <Route path="/customers" element={<RequireAdminAuth><SuspensePage><AdminCustomers /></SuspensePage></RequireAdminAuth>} />
              <Route path="/orders" element={<RequireAdminAuth><SuspensePage><AdminOrders /></SuspensePage></RequireAdminAuth>} />
              <Route path="/categories" element={<RequireAdminAuth><SuspensePage><AdminCategories /></SuspensePage></RequireAdminAuth>} />
              <Route path="/menu" element={<RequireAdminAuth><SuspensePage><AdminMenu /></SuspensePage></RequireAdminAuth>} />
              <Route path="/delivery-options" element={<RequireAdminAuth><SuspensePage><AdminDeliveryOptions /></SuspensePage></RequireAdminAuth>} />
              <Route path="/payment-options" element={<RequireAdminAuth><SuspensePage><AdminPaymentOptions /></SuspensePage></RequireAdminAuth>} />
              
              {/* Backward compatibility support for /admin path prefixes in subdomain */}
              <Route path="/admin" element={<Navigate to="/" replace />} />
              <Route path="/admin/manage-shop" element={<Navigate to="/manage-shop" replace />} />
              <Route path="/admin/customers" element={<Navigate to="/customers" replace />} />
              <Route path="/admin/orders" element={<Navigate to="/orders" replace />} />
              <Route path="/admin/categories" element={<Navigate to="/categories" replace />} />
              <Route path="/admin/menu" element={<Navigate to="/menu" replace />} />
              <Route path="/admin/delivery-options" element={<Navigate to="/delivery-options" replace />} />
              <Route path="/admin/payment-options" element={<Navigate to="/payment-options" replace />} />
              
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Router>
        </CategoryProvider>
      </AuthProvider>
    );
  }

  return (
    <AuthProvider>
      <AddressProvider>
        <CartProvider>
          <CategoryProvider>
            <Router>
              <ScrollToTop />
              <AdminOrderAlertGate />
              <PWAInstallBanner />
              <PushNotificationManager />
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/about-us" element={<AboutUs />} />
                <Route path="/contact-us" element={<ContactUs />} />
                <Route path="/privacy-policy" element={<SuspensePage><PrivacyPolicy /></SuspensePage>} />
                <Route path="/terms-of-service" element={<SuspensePage><TermsOfService /></SuspensePage>} />
                <Route path="/refund-replacement-policy" element={<SuspensePage><RefundReplacementPolicy /></SuspensePage>} />
                <Route path="/delivery-policy" element={<SuspensePage><DeliveryPolicy /></SuspensePage>} />
                <Route path="/login" element={<Login />} />
                
                {/* Redirect admin access on storefront domain to the subdomain */}
                <Route path="/admin/login" element={<RedirectToAdminSubdomain />} />
                <Route path="/admin" element={<RedirectToAdminSubdomain />} />
                <Route path="/admin/*" element={<RedirectToAdminSubdomain />} />
                
                <Route path="/dashboard" element={<RequireUserAuth><UserDashboard /></RequireUserAuth>} />
                <Route path="/rewards" element={<RequireUserAuth><PointsDashboard /></RequireUserAuth>} />
                <Route path="/orders" element={<RequireUserAuth><OrderHistory /></RequireUserAuth>} />
                <Route path="/addresses" element={<RequireUserAuth><SavedAddresses /></RequireUserAuth>} />
                <Route path="/account" element={<RequireUserAuth><ManageAccount /></RequireUserAuth>} />
                <Route path="/complete-profile" element={<RequireUserAuth><CompleteProfile /></RequireUserAuth>} />
                <Route path="/checkout" element={<RequireUserAuth requirePhone><Checkout /></RequireUserAuth>} />
                <Route path="/scan-pay" element={<RequireUserAuth requirePhone><ScanPay /></RequireUserAuth>} />
                <Route path="/success" element={<RequireUserAuth><OrderSuccess /></RequireUserAuth>} />
                <Route path="/failed" element={<OrderFailed />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Router>
          </CategoryProvider>
        </CartProvider>
      </AddressProvider>
    </AuthProvider>
  );
};

export default App;
