import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import BrandLogo from '../components/BrandLogo';
import AdminMobileNav from '../components/AdminMobileNav';
import AdminSidebarNav from '../components/AdminSidebarNav';
import AdminSidebarFooter from '../components/AdminSidebarFooter';

type NoticeType = 'success' | 'error';

const AdminPaymentOptions: React.FC = () => {
  const [curlecEnabled, setCurlecEnabled] = useState(true);
  const [curlecConfigured, setCurlecConfigured] = useState(false);
  const [curlecKeyId, setCurlecKeyId] = useState('');
  const [curlecDisplayName, setCurlecDisplayName] = useState('Online Payment');
  const [serviceFeeInput, setServiceFeeInput] = useState('1.80');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState<{ message: string; type: NoticeType } | null>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const { logout } = useAuth();

  const showNotice = (message: string, type: NoticeType) => {
    setNotice({ message, type });
  };

  const loadOptions = async () => {
    setIsLoading(true);
    try {
      const options = await api.getAdminPaymentOptions();
      setCurlecEnabled(Boolean(options.curlecEnabled));
      setCurlecConfigured(Boolean(options.curlecConfigured));
      setCurlecKeyId(options.curlecKeyId || '');
      setCurlecDisplayName(options.curlecDisplayName || 'Online Payment');
      setServiceFeeInput(Number(options.serviceFee ?? 1.8).toFixed(2));
    } catch (error) {
      console.error('Failed to load payment options', error);
      showNotice('Failed to load payment options', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadOptions();
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timeoutId = window.setTimeout(() => setNotice(null), 3500);
    return () => window.clearTimeout(timeoutId);
  }, [notice]);

  const handleSave = async () => {
    const parsedServiceFee = Number(serviceFeeInput);
    if (!Number.isFinite(parsedServiceFee)) {
      showNotice('Service fee must be a valid number.', 'error');
      return;
    }
    if (parsedServiceFee < 0) {
      showNotice('Service fee cannot be negative.', 'error');
      return;
    }
    if (parsedServiceFee > 9999) {
      showNotice('Service fee is too large.', 'error');
      return;
    }
    const normalizedServiceFee = Number(parsedServiceFee.toFixed(2));

    setIsSaving(true);
    try {
      const response = await api.updateAdminPaymentOptions({
        curlecEnabled,
        serviceFee: normalizedServiceFee
      });
      setCurlecEnabled(Boolean(response.curlecEnabled));
      setCurlecConfigured(Boolean(response.curlecConfigured));
      setCurlecKeyId(response.curlecKeyId || '');
      setCurlecDisplayName(response.curlecDisplayName || 'Online Payment');
      setServiceFeeInput(Number(response.serviceFee ?? normalizedServiceFee).toFixed(2));
      showNotice('Payment options updated', 'success');
    } catch (error) {
      console.error('Failed to update payment options', error);
      showNotice('Failed to update payment options', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  const maskedCurlecKeyId = curlecKeyId
    ? `${curlecKeyId.slice(0, 8)}${curlecKeyId.length > 8 ? '...' : ''}`
    : 'Not set';

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
          <h2 className="text-3xl font-extrabold tracking-tight">Payment Options</h2>
          <p className="text-slate-500">
            Curlec is the only supported checkout method. Configure service fee and enable/disable online payment.
          </p>
        </header>

        <section className="max-w-4xl bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-2xl p-4 sm:p-6 shadow-sm space-y-6">
          {isLoading ? (
            <div className="text-sm text-slate-500">Loading options...</div>
          ) : (
            <>
              <div className="border border-gray-100 dark:border-slate-700 rounded-xl p-4 flex items-start justify-between gap-4">
                <div>
                  <p className="font-bold">{curlecDisplayName || 'Online Payment'} (Curlec)</p>
                  <p className="text-sm text-slate-500">
                    FPX, cards and eWallet methods based on your Curlec account setup.
                  </p>
                  {!curlecConfigured && (
                    <p className="text-xs text-amber-700 mt-1">
                      Curlec keys are not configured on the server. Checkout will fail until configured.
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setCurlecEnabled((prev) => !prev)}
                  className={`h-7 w-14 rounded-full transition-colors relative ${curlecEnabled ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'}`}
                  aria-label="Toggle Curlec"
                  aria-pressed={curlecEnabled}
                >
                  <span
                    className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${
                      curlecEnabled ? 'translate-x-7' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </div>

              <div className="space-y-2">
                <label htmlFor="serviceFee" className="text-sm font-bold">
                  Service Fee (MYR)
                </label>
                <div className="relative w-full sm:max-w-xs">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-500">
                    RM
                  </span>
                  <input
                    id="serviceFee"
                    type="number"
                    min="0"
                    step="0.01"
                    value={serviceFeeInput}
                    onChange={(e) => setServiceFeeInput(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 pl-10 pr-4 py-2.5 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                </div>
                <p className="text-xs text-slate-500">
                  Applied to every order at checkout and shown in customer totals.
                </p>
              </div>

              <div className="border border-gray-100 dark:border-slate-700 rounded-xl p-4 space-y-3 max-w-md">
                <p className="text-xs uppercase tracking-wide text-slate-500 font-bold">Curlec Status</p>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-500">Server keys</span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                      curlecConfigured
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : 'bg-amber-50 text-amber-700 border border-amber-200'
                    }`}
                  >
                    {curlecConfigured ? 'Configured' : 'Missing'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-500">Public key</span>
                  <span className="font-mono text-xs text-slate-700 dark:text-slate-200">{maskedCurlecKeyId}</span>
                </div>
                <p className="text-xs text-slate-500">
                  Configure `CURLEC_KEY_ID` and `CURLEC_KEY_SECRET` in your backend environment.
                </p>
              </div>

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

export default AdminPaymentOptions;
