import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import BrandLogo from '../components/BrandLogo';
import AdminMobileNav from '../components/AdminMobileNav';
import AdminSidebarNav from '../components/AdminSidebarNav';
import AdminSidebarFooter from '../components/AdminSidebarFooter';
import { formatCurrency } from '../utils/currency';
import { AdminSalesOverview } from '../types';

type ReportPreset = 'today' | 'week' | 'month' | 'custom';

const getKualaLumpurDateString = () => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === 'year')?.value || '1970';
  const month = parts.find((part) => part.type === 'month')?.value || '01';
  const day = parts.find((part) => part.type === 'day')?.value || '01';
  return `${year}-${month}-${day}`;
};

const AdminDashboard: React.FC = () => {
  const [status, setStatus] = useState<{status: string, mode: string}>({ status: 'checking', mode: 'server' });
  const [salesOverview, setSalesOverview] = useState<AdminSalesOverview | null>(null);
  const [voucherStats, setVoucherStats] = useState({ today: 0, thisWeek: 0, thisMonth: 0 });
  const [isSalesLoading, setIsSalesLoading] = useState(true);
  const [salesError, setSalesError] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [reportPreset, setReportPreset] = useState<ReportPreset>('month');
  const [customFrom, setCustomFrom] = useState(() => {
    const today = getKualaLumpurDateString();
    return `${today.slice(0, 8)}01`;
  });
  const [customTo, setCustomTo] = useState(() => getKualaLumpurDateString());
  const location = useLocation();
  const navigate = useNavigate();
  const { logout } = useAuth();

  useEffect(() => {
     const checkHealth = async () => {
        const res = await api.checkStatus();
        setStatus(res);
     };
     
     checkHealth();
     const interval = setInterval(checkHealth, 5000); 
     return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const loadSalesOverview = async (showLoading = true) => {
      if (showLoading) setIsSalesLoading(true);
      try {
        const overview = await api.getAdminSalesOverview();
        setSalesOverview(overview);
        setSalesError('');
      } catch (error: any) {
        console.error('Failed to load sales overview:', error);
        setSalesError(error?.message || 'Failed to load sales overview');
      } finally {
        if (showLoading) setIsSalesLoading(false);
      }
    };

    loadSalesOverview(true);
    const interval = setInterval(() => loadSalesOverview(false), 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const loadVoucherStats = async () => {
      try {
        setVoucherStats(await api.getAdminVoucherStats());
      } catch (error) {
        console.error('Failed to fetch voucher stats', error);
      }
    };
    loadVoucherStats();
  }, []);

  const handleLogout = () => {
    logout();
    navigate('/admin/login', { replace: true });
  };

  const formatTrend = (value: number) => {
    const normalized = Number.isFinite(value) ? value : 0;
    const sign = normalized > 0 ? '+' : '';
    return `${sign}${normalized.toFixed(1)}%`;
  };

  const trendClass = (value: number) => {
    if (value > 0) return 'bg-emerald-100 text-emerald-700';
    if (value < 0) return 'bg-rose-100 text-rose-700';
    return 'bg-slate-100 text-slate-600';
  };

  const handleExportCsv = async () => {
    const params: {
      preset?: ReportPreset;
      from?: string;
      to?: string;
    } = {};

    if (reportPreset === 'custom') {
      if (!customFrom || !customTo) {
        setExportError('Please set both From and To dates for custom report.');
        return;
      }
      if (customFrom > customTo) {
        setExportError('From date must be earlier than or equal to To date.');
        return;
      }
      params.preset = 'custom';
      params.from = customFrom;
      params.to = customTo;
    } else {
      params.preset = reportPreset;
    }

    try {
      setIsExporting(true);
      setExportError('');
      const blob = await api.downloadAdminSalesReportCsv(params);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      link.href = url;
      link.download = `sales-report-${stamp}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error: any) {
      setExportError(error?.message || 'Failed to export CSV');
    } finally {
      setIsExporting(false);
    }
  };

  const cards = [
    {
      key: 'daily',
      title: 'Daily Sales',
      amount: salesOverview?.dailySales ?? 0,
      trend: salesOverview?.dailyGrowthPct ?? 0,
      orders: salesOverview?.dailyOrders ?? 0
    },
    {
      key: 'weekly',
      title: 'Weekly Sales',
      amount: salesOverview?.weeklySales ?? 0,
      trend: salesOverview?.weeklyGrowthPct ?? 0,
      orders: salesOverview?.weeklyOrders ?? 0
    },
    {
      key: 'monthly',
      title: 'Monthly Sales',
      amount: salesOverview?.monthlySales ?? 0,
      trend: salesOverview?.monthlyGrowthPct ?? 0,
      orders: salesOverview?.monthlyOrders ?? 0
    }
  ];

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
          <header className="mb-8 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
             <div>
                <h2 className="text-3xl font-extrabold tracking-tight">Store Overview</h2>
                <p className="text-slate-500">Live sales from real backend orders.</p>
             </div>
             <div className="w-full xl:w-auto flex flex-col gap-2">
                <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                   <select
                      value={reportPreset}
                      onChange={(event) => setReportPreset(event.target.value as ReportPreset)}
                      className="px-3 py-2 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-semibold"
                   >
                      <option value="today">Today</option>
                      <option value="week">This Week</option>
                      <option value="month">This Month</option>
                      <option value="custom">Custom Range</option>
                   </select>
                   {reportPreset === 'custom' && (
                      <>
                         <input
                            type="date"
                            value={customFrom}
                            onChange={(event) => setCustomFrom(event.target.value)}
                            className="px-3 py-2 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-semibold"
                         />
                         <input
                            type="date"
                            value={customTo}
                            onChange={(event) => setCustomTo(event.target.value)}
                            className="px-3 py-2 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-semibold"
                         />
                      </>
                   )}
                   <button
                      onClick={handleExportCsv}
                      disabled={isExporting}
                      className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-primary text-white text-sm font-bold hover:bg-primary/90 disabled:opacity-60"
                   >
                      <span className="material-symbols-outlined text-base">download</span>
                      {isExporting ? 'Exporting...' : 'Export CSV'}
                   </button>
                </div>
                {exportError && <p className="text-xs text-rose-600 font-semibold">{exportError}</p>}
             </div>
          </header>

          {/* Stats Grid */}
          <section className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
             {cards.map((card) => (
                <div key={card.key} className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-primary/10 shadow-sm relative overflow-hidden">
                   <div className="flex justify-between items-start mb-4 gap-2">
                      <div>
                         <p className="text-sm font-semibold text-slate-500 uppercase tracking-wider">{card.title}</p>
                         <h3 className="text-3xl font-bold mt-1">
                            {isSalesLoading ? 'Loading...' : formatCurrency(card.amount)}
                         </h3>
                      </div>
                      <div className={`px-2 py-1 rounded text-sm font-bold ${trendClass(card.trend)}`}>
                         {formatTrend(card.trend)}
                      </div>
                   </div>
                   <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                      {card.orders} order{card.orders === 1 ? '' : 's'}
                   </p>
                </div>
             ))}
          </section>

          {/* Voucher Stats Grid */}
          <h3 className="text-xl font-bold mb-4">Voucher Redemptions</h3>
          <section className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
             <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-primary/10 shadow-sm relative overflow-hidden">
                <div className="flex justify-between items-start mb-4 gap-2">
                   <div>
                      <p className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Redeemed Today</p>
                      <h3 className="text-3xl font-bold mt-1 text-[#0d1c0d] dark:text-white">
                         {formatCurrency(voucherStats.today)}
                      </h3>
                   </div>
                </div>
             </div>
             <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-primary/10 shadow-sm relative overflow-hidden">
                <div className="flex justify-between items-start mb-4 gap-2">
                   <div>
                      <p className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Redeemed This Week</p>
                      <h3 className="text-3xl font-bold mt-1 text-[#0d1c0d] dark:text-white">
                         {formatCurrency(voucherStats.thisWeek)}
                      </h3>
                   </div>
                </div>
             </div>
             <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-primary/10 shadow-sm relative overflow-hidden">
                <div className="flex justify-between items-start mb-4 gap-2">
                   <div>
                      <p className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Redeemed This Month</p>
                      <h3 className="text-3xl font-bold mt-1 text-[#0d1c0d] dark:text-white">
                         {formatCurrency(voucherStats.thisMonth)}
                      </h3>
                   </div>
                </div>
             </div>
          </section>

          {salesError && (
             <div className="mb-6 p-4 rounded-xl border border-rose-200 bg-rose-50 text-rose-700 text-sm font-semibold">
                {salesError}
             </div>
          )}
          
          <div className={`p-6 rounded-xl border ${
              status.status === 'connected' ? 'bg-green-50 border-green-200 text-green-800 dark:bg-green-900/10 dark:border-green-800 dark:text-green-300' : 'bg-orange-50 border-orange-200 text-orange-800 dark:bg-orange-900/10 dark:border-orange-800 dark:text-orange-300'
          }`}>
             <h3 className="text-lg font-bold mb-2 flex items-center gap-2">
                 <span className="material-symbols-outlined">{status.status === 'connected' ? 'check_circle' : 'warning'}</span>
                 System Status: Real Backend Server
             </h3>
             <p className="text-sm opacity-80 mb-4">
                {status.status === 'connected'
                    ? "Successfully connected to your Node.js + MariaDB backend."
                    : "Cannot reach backend API. Ensure your server is running."}
             </p>
             <div className="text-xs font-mono bg-white dark:bg-black/20 p-3 rounded border border-gray-200 dark:border-white/5">
                 Mode: SERVER<br/>
                 Status: {status.status.toUpperCase()}
             </div>
          </div>
       </main>
    </div>
  );
};

export default AdminDashboard;
