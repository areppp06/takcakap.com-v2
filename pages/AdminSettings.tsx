import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import BrandLogo from '../components/BrandLogo';
import AdminMobileNav from '../components/AdminMobileNav';
import AdminSidebarNav from '../components/AdminSidebarNav';
import AdminSidebarFooter from '../components/AdminSidebarFooter';
import AdminKitchenAlerts from '../components/AdminKitchenAlerts';

const AdminSettings: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { logout } = useAuth();

  const handleLogout = () => {
    logout();
    navigate('/admin/login', { replace: true });
  };

  return (
    <div className="flex min-h-screen bg-background-light dark:bg-background-dark text-slate-900 dark:text-white">
       {/* Sidebar */}
       <aside className="hidden lg:flex w-64 border-r border-primary/10 bg-white dark:bg-background-dark/50 flex-col fixed h-full z-20">
          <Link to="/" aria-label="Go to home" className="p-6 flex items-center justify-center">
             <BrandLogo
               alt="Brand logo"
               className="h-10 w-10 object-contain"
               fallbackIcon="restaurant"
               fallbackIconClassName="material-symbols-outlined text-primary text-4xl"
             />
          </Link>
          <AdminSidebarNav currentPath={location.pathname} />
          <AdminSidebarFooter onLogout={handleLogout} />
       </aside>

       {/* Main Content */}
       <main className="lg:ml-64 flex-1 p-4 sm:p-6 lg:p-8 overflow-y-auto pb-24 lg:pb-8">
          <AdminMobileNav currentPath={location.pathname} onLogout={handleLogout} />
          <header className="mb-8">
             <h2 className="text-3xl font-extrabold tracking-tight flex items-center gap-3">
                <span className="material-symbols-outlined text-primary text-3xl">settings</span>
                Settings
             </h2>
             <p className="text-slate-500 mt-1">Notification alerts, device configuration, and system diagnostics.</p>
          </header>

          <AdminKitchenAlerts />
       </main>
    </div>
  );
};

export default AdminSettings;
