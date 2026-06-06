import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import BrandLogo from '../components/BrandLogo';
import AdminMobileNav from '../components/AdminMobileNav';
import AdminSidebarNav from '../components/AdminSidebarNav';
import AdminSidebarFooter from '../components/AdminSidebarFooter';

type NoticeType = 'success' | 'error';

const AdminDeliveryOptions: React.FC = () => {
  const [pickupEnabled, setPickupEnabled] = useState(true);
  const [lalamoveEnabled, setLalamoveEnabled] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState<{ message: string; type: NoticeType } | null>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const { logout } = useAuth();

  const isActive = (path: string) => location.pathname === path;
  const showNotice = (message: string, type: NoticeType) => {
    setNotice({ message, type });
  };

  const loadOptions = async () => {
    setIsLoading(true);
    try {
      const options = await api.getAdminDeliveryOptions();
      setPickupEnabled(options.pickupEnabled);
      setLalamoveEnabled(options.lalamoveEnabled);
    } catch (error) {
      console.error('Failed to load delivery options', error);
      showNotice('Failed to load delivery options', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadOptions();
  }, []);

  useEffect(() => {
    if (!notice) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      setNotice(null);
    }, 3000);
    return () => window.clearTimeout(timeoutId);
  }, [notice]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const response = await api.updateAdminDeliveryOptions({
        pickupEnabled,
        lalamoveEnabled
      });
      setPickupEnabled(response.pickupEnabled);
      setLalamoveEnabled(response.lalamoveEnabled);
      showNotice('Delivery options updated', 'success');
    } catch (error) {
      console.error('Failed to update delivery options', error);
      showNotice('Failed to update delivery options', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/admin/login', { replace: true });
  };

  return (
    <div className="flex min-h-screen bg-background-light dark:bg-background-dark text-slate-900 dark:text-white">
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

      <main className="lg:ml-64 flex-1 p-4 sm:p-6 lg:p-8 overflow-y-auto pb-24 lg:pb-8">
          <AdminMobileNav currentPath={location.pathname} onLogout={handleLogout} />
        {notice && (
          <div
            className={`fixed top-4 left-1/2 -translate-x-1/2 sm:left-auto sm:right-6 sm:translate-x-0 z-50 w-[calc(100vw-2rem)] max-w-sm rounded-xl border px-4 py-3 shadow-lg backdrop-blur-sm transition-all ${
              notice.type === 'success'
                ? 'border-emerald-200 bg-emerald-50/95 text-emerald-800'
                : 'border-rose-200 bg-rose-50/95 text-rose-800'
            }`}
            role="status"
            aria-live="polite"
          >
            <div className="flex items-center gap-3">
              <span
                className={`inline-block h-2.5 w-2.5 rounded-full ${
                  notice.type === 'success' ? 'bg-emerald-500' : 'bg-rose-500'
                }`}
                aria-hidden="true"
              />
              <p className="text-sm font-semibold">{notice.message}</p>
              <button
                onClick={() => setNotice(null)}
                className="ml-2 text-current/70 hover:text-current transition-colors"
                aria-label="Close notification"
              >
                <span className="material-symbols-outlined text-base leading-none">close</span>
              </button>
            </div>
          </div>
        )}

        <header className="mb-8">
          <h2 className="text-3xl font-extrabold tracking-tight">Delivery Options</h2>
          <p className="text-slate-500">Enable or disable checkout delivery methods.</p>
        </header>

        <section className="max-w-2xl bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-2xl p-4 sm:p-6 shadow-sm space-y-6">
          {isLoading ? (
            <div className="text-sm text-slate-500">Loading options...</div>
          ) : (
            <>
              <div className="flex flex-col items-start gap-4 border border-gray-100 dark:border-slate-700 rounded-xl p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-bold">Store Pickup</p>
                  <p className="text-xs text-slate-500 mt-1">Customer can choose self pickup at checkout.</p>
                </div>
                <label className="inline-flex items-center gap-3 cursor-pointer">
                  <span className={`text-xs font-semibold ${pickupEnabled ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'}`}>
                    {pickupEnabled ? 'Enabled' : 'Unavailable'}
                  </span>
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={pickupEnabled}
                    onChange={(e) => setPickupEnabled(e.target.checked)}
                  />
                  <span className="relative h-6 w-11 rounded-full bg-gray-200 dark:bg-slate-700 transition-colors duration-300 ease-out peer-checked:bg-primary peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow-sm after:transition-transform after:duration-300 after:ease-out peer-checked:after:translate-x-5" />
                </label>
              </div>

              <div className="flex flex-col items-start gap-4 border border-gray-100 dark:border-slate-700 rounded-xl p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-bold">Lalamove Delivery</p>
                  <p className="text-xs text-slate-500 mt-1">Customer can choose Lalamove delivery at checkout.</p>
                </div>
                <label className="inline-flex items-center gap-3 cursor-pointer">
                  <span className={`text-xs font-semibold ${lalamoveEnabled ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'}`}>
                    {lalamoveEnabled ? 'Enabled' : 'Unavailable'}
                  </span>
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={lalamoveEnabled}
                    onChange={(e) => setLalamoveEnabled(e.target.checked)}
                  />
                  <span className="relative h-6 w-11 rounded-full bg-gray-200 dark:bg-slate-700 transition-colors duration-300 ease-out peer-checked:bg-primary peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow-sm after:transition-transform after:duration-300 after:ease-out peer-checked:after:translate-x-5" />
                </label>
              </div>

              {!pickupEnabled && !lalamoveEnabled && (
                <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  Both options are disabled. Checkout will show all delivery methods as unavailable.
                </div>
              )}

              <div className="pt-2 flex justify-end">
                <button
                  onClick={handleSave}
                  disabled={isSaving}
                  className="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-primary text-white font-bold hover:bg-primary/90 active:scale-[0.99] transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isSaving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </>
          )}
        </section>
      </main>
    </div>
  );
};

export default AdminDeliveryOptions;
