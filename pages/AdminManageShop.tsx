import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import BrandLogo from '../components/BrandLogo';
import AdminMobileNav from '../components/AdminMobileNav';
import AdminSidebarNav from '../components/AdminSidebarNav';
import AdminSidebarFooter from '../components/AdminSidebarFooter';
import { ShopStatus } from '../types';

type NoticeType = 'success' | 'error';

const AdminManageShop: React.FC = () => {
  const [openTime, setOpenTime] = useState('09:00');
  const [closeTime, setCloseTime] = useState('22:00');
  const [pauseOrders, setPauseOrders] = useState(false);
  const [storeName, setStoreName] = useState('');
  const [storePhone, setStorePhone] = useState('');
  const [storeAddress, setStoreAddress] = useState('');
  const [storeLatitude, setStoreLatitude] = useState('');
  const [storeLongitude, setStoreLongitude] = useState('');
  const [statusPreview, setStatusPreview] = useState<ShopStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState<{ message: string; type: NoticeType } | null>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const { logout } = useAuth();

  const isActive = (path: string) => location.pathname === path;
  const showNotice = (message: string, type: NoticeType) => setNotice({ message, type });

  const loadSettings = async () => {
    setIsLoading(true);
    try {
      const settings = await api.getAdminShopSettings();
      setOpenTime(settings.openTime);
      setCloseTime(settings.closeTime);
      setPauseOrders(settings.pauseOrders);
      setStoreName(settings.storeName || '');
      setStorePhone(settings.storePhone || '');
      setStoreAddress(settings.storeAddress || '');
      setStoreLatitude(
        Number.isFinite(settings.storeLatitude) ? String(settings.storeLatitude) : ''
      );
      setStoreLongitude(
        Number.isFinite(settings.storeLongitude) ? String(settings.storeLongitude) : ''
      );
      setStatusPreview(settings);
    } catch (error) {
      console.error('Failed to load shop settings', error);
      showNotice('Failed to load shop settings', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timeoutId = window.setTimeout(() => setNotice(null), 3000);
    return () => window.clearTimeout(timeoutId);
  }, [notice]);

  const handleSave = async () => {
    if (!openTime || !closeTime) {
      showNotice('Operating hours are required', 'error');
      return;
    }
    if (openTime === closeTime) {
      showNotice('Open and close time cannot be the same', 'error');
      return;
    }
    if (!storeName.trim()) {
      showNotice('Store name is required', 'error');
      return;
    }
    if (!storePhone.trim()) {
      showNotice('Store phone is required', 'error');
      return;
    }
    if (!storeAddress.trim()) {
      showNotice('Store address is required', 'error');
      return;
    }
    const parsedLat = Number(storeLatitude);
    const parsedLng = Number(storeLongitude);
    if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLng)) {
      showNotice('Store latitude and longitude must be valid numbers', 'error');
      return;
    }
    if (parsedLat < -90 || parsedLat > 90 || parsedLng < -180 || parsedLng > 180) {
      showNotice('Store coordinates are out of range', 'error');
      return;
    }

    setIsSaving(true);
    try {
      const updated = await api.updateAdminShopSettings({
        openTime,
        closeTime,
        pauseOrders,
        storeName: storeName.trim(),
        storePhone: storePhone.trim(),
        storeAddress: storeAddress.trim(),
        storeLatitude: parsedLat,
        storeLongitude: parsedLng
      });
      setOpenTime(updated.openTime);
      setCloseTime(updated.closeTime);
      setPauseOrders(updated.pauseOrders);
      setStoreName(updated.storeName || '');
      setStorePhone(updated.storePhone || '');
      setStoreAddress(updated.storeAddress || '');
      setStoreLatitude(
        Number.isFinite(updated.storeLatitude) ? String(updated.storeLatitude) : ''
      );
      setStoreLongitude(
        Number.isFinite(updated.storeLongitude) ? String(updated.storeLongitude) : ''
      );
      setStatusPreview(updated);
      showNotice('Shop settings updated', 'success');
    } catch (error) {
      console.error('Failed to update shop settings', error);
      showNotice('Failed to update shop settings', 'error');
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
              <span className={`inline-block h-2.5 w-2.5 rounded-full ${notice.type === 'success' ? 'bg-emerald-500' : 'bg-rose-500'}`} />
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
          <h2 className="text-3xl font-extrabold tracking-tight">Manage Shop</h2>
          <p className="text-slate-500">Configure operating hours, pause ordering, and store pickup location.</p>
        </header>

        <section className="max-w-3xl bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-2xl p-4 sm:p-6 shadow-sm space-y-6">
          {isLoading ? (
            <div className="text-sm text-slate-500">Loading shop settings...</div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="openTime" className="text-sm font-bold">Operating Start (HH:MM)</label>
                  <input
                    id="openTime"
                    type="time"
                    value={openTime}
                    onChange={(e) => setOpenTime(e.target.value)}
                    className="mt-2 w-full rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                </div>
                <div>
                  <label htmlFor="closeTime" className="text-sm font-bold">Operating End (HH:MM)</label>
                  <input
                    id="closeTime"
                    type="time"
                    value={closeTime}
                    onChange={(e) => setCloseTime(e.target.value)}
                    className="mt-2 w-full rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                </div>
              </div>
              <p className="text-xs text-slate-500">Timezone: Asia/Kuala_Lumpur</p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="storeName" className="text-sm font-bold">Store Name</label>
                  <input
                    id="storeName"
                    type="text"
                    value={storeName}
                    onChange={(e) => setStoreName(e.target.value)}
                    placeholder="TakCakap KL Sentral"
                    className="mt-2 w-full rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                </div>
                <div>
                  <label htmlFor="storePhone" className="text-sm font-bold">Store Phone (E.164)</label>
                  <input
                    id="storePhone"
                    type="tel"
                    value={storePhone}
                    onChange={(e) => setStorePhone(e.target.value)}
                    placeholder="+60123456789"
                    className="mt-2 w-full rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="storeAddress" className="text-sm font-bold">Store Address</label>
                  <input
                    id="storeAddress"
                    type="text"
                    value={storeAddress}
                    onChange={(e) => setStoreAddress(e.target.value)}
                    placeholder="Jalan Stesen Sentral 5, Kuala Lumpur"
                    className="mt-2 w-full rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                </div>
                <div>
                  <label htmlFor="storeLatitude" className="text-sm font-bold">Store Latitude</label>
                  <input
                    id="storeLatitude"
                    type="number"
                    step="0.0000001"
                    value={storeLatitude}
                    onChange={(e) => setStoreLatitude(e.target.value)}
                    placeholder="3.1347"
                    className="mt-2 w-full rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                </div>
                <div>
                  <label htmlFor="storeLongitude" className="text-sm font-bold">Store Longitude</label>
                  <input
                    id="storeLongitude"
                    type="number"
                    step="0.0000001"
                    value={storeLongitude}
                    onChange={(e) => setStoreLongitude(e.target.value)}
                    placeholder="101.6869"
                    className="mt-2 w-full rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                </div>
              </div>

              <div className="flex flex-col items-start gap-4 border border-gray-100 dark:border-slate-700 rounded-xl p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-bold">Pause Online Orders</p>
                  <p className="text-xs text-slate-500 mt-1">Temporarily disable all online orders without changing stock.</p>
                </div>
                <label className="inline-flex items-center gap-3 cursor-pointer">
                  <span className={`text-xs font-semibold ${pauseOrders ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                    {pauseOrders ? 'Paused' : 'Active'}
                  </span>
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={pauseOrders}
                    onChange={(e) => setPauseOrders(e.target.checked)}
                  />
                  <span className="relative h-6 w-11 rounded-full bg-gray-200 dark:bg-slate-700 transition-colors duration-300 ease-out peer-checked:bg-primary peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow-sm after:transition-transform after:duration-300 after:ease-out peer-checked:after:translate-x-5" />
                </label>
              </div>

              {statusPreview && !statusPreview.isOrderable && (
                <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  {statusPreview.message}
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

export default AdminManageShop;
