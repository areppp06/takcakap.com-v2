import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { AdminCustomer } from '../types';
import { formatCurrency } from '../utils/currency';
import { useAuth } from '../contexts/AuthContext';
import BrandLogo from '../components/BrandLogo';
import AdminMobileNav from '../components/AdminMobileNav';
import AdminSidebarNav from '../components/AdminSidebarNav';
import AdminSidebarFooter from '../components/AdminSidebarFooter';

type StatusFilter = 'all' | 'active' | 'suspended';

type SuspensionDialog = {
  customer: AdminCustomer;
  nextSuspended: boolean;
} | null;

const formatDateTime = (value?: string | null) => {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return date.toLocaleDateString();
};

const AdminCustomers: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { logout } = useAuth();

  const [customers, setCustomers] = useState<AdminCustomer[]>([]);
  const [stats, setStats] = useState({
    totalCustomers: 0,
    activeCustomers: 0,
    suspendedCustomers: 0,
    newThisWeek: 0
  });
  const [isLoading, setIsLoading] = useState(true);
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [suspensionDialog, setSuspensionDialog] = useState<SuspensionDialog>(null);
  const [isUpdatingSuspension, setIsUpdatingSuspension] = useState(false);

  const isActive = (path: string) => location.pathname === path;

  const handleLogout = () => {
    logout();
    navigate('/admin/login', { replace: true });
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const loadCustomers = async () => {
    setIsLoading(true);
    try {
      const response = await api.getAdminCustomers({
        search: debouncedSearch || undefined,
        status: statusFilter
      });
      setCustomers(response.customers);
      setStats(response.stats);
    } catch (error) {
      console.error('Failed to fetch customers', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadCustomers();
  }, [debouncedSearch, statusFilter]);

  const confirmSuspensionUpdate = async () => {
    if (!suspensionDialog) return;
    const { customer, nextSuspended } = suspensionDialog;
    setIsUpdatingSuspension(true);
    try {
      const response = await api.updateAdminCustomerSuspension(customer.id, nextSuspended);
      const updated = response.customer;

      setCustomers((prev) =>
        prev.map((item) =>
          item.id === customer.id
            ? {
                ...item,
                isSuspended: updated.isSuspended,
                suspendedAt: updated.suspendedAt ?? null
              }
            : item
        )
      );

      setStats((prev) => {
        const wasSuspended = customer.isSuspended;
        if (wasSuspended === nextSuspended) return prev;
        return {
          ...prev,
          activeCustomers: prev.activeCustomers + (nextSuspended ? -1 : 1),
          suspendedCustomers: prev.suspendedCustomers + (nextSuspended ? 1 : -1)
        };
      });

      if (statusFilter === 'active' && nextSuspended) {
        setCustomers((prev) => prev.filter((item) => item.id !== customer.id));
      }
      if (statusFilter === 'suspended' && !nextSuspended) {
        setCustomers((prev) => prev.filter((item) => item.id !== customer.id));
      }
    } catch (error) {
      console.error('Failed to update suspension', error);
    } finally {
      setIsUpdatingSuspension(false);
      setSuspensionDialog(null);
    }
  };

  const visibleCountLabel = useMemo(() => {
    if (isLoading) return 'Loading...';
    return `Showing ${customers.length} customer${customers.length === 1 ? '' : 's'}`;
  }, [customers.length, isLoading]);

  const openSuspensionDialog = (customer: AdminCustomer) => {
    setSuspensionDialog({
      customer,
      nextSuspended: !customer.isSuspended
    });
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
        <header className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-8">
          <div>
            <h2 className="text-3xl font-extrabold tracking-tight">Customer Management</h2>
            <p className="text-slate-500">Monitor customer accounts and review their order activity.</p>
          </div>
          <div className="w-full lg:w-[360px]">
            <div className="relative">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-lg">search</span>
              <input
                type="text"
                placeholder="Search customer name, email, or phone"
                className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
              />
            </div>
          </div>
        </header>

        <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
          <div className="bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-2xl p-5 shadow-sm">
            <p className="text-xs uppercase tracking-wider font-bold text-slate-500">Total Customers</p>
            <p className="text-3xl font-extrabold mt-2">{stats.totalCustomers.toLocaleString()}</p>
          </div>
          <div className="bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-2xl p-5 shadow-sm">
            <p className="text-xs uppercase tracking-wider font-bold text-slate-500">Active Users (Last 7 days)</p>
            <p className="text-3xl font-extrabold mt-2 text-green-600 dark:text-green-400">{stats.activeCustomers.toLocaleString()}</p>
          </div>
          <div className="bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-2xl p-5 shadow-sm">
            <p className="text-xs uppercase tracking-wider font-bold text-slate-500">Suspended</p>
            <p className="text-3xl font-extrabold mt-2 text-red-600 dark:text-red-400">{stats.suspendedCustomers.toLocaleString()}</p>
          </div>
          <div className="bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-2xl p-5 shadow-sm">
            <p className="text-xs uppercase tracking-wider font-bold text-slate-500">New This Week</p>
            <p className="text-3xl font-extrabold mt-2 text-primary">{stats.newThisWeek.toLocaleString()}</p>
          </div>
        </section>

        <section className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 dark:border-slate-700 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <h3 className="font-bold text-xl">Customers</h3>
              <p className="text-sm text-slate-500">{visibleCountLabel}</p>
            </div>
            <div className="overflow-x-auto">
              <div className="flex items-center gap-2 min-w-max">
                {(['all', 'active', 'suspended'] as StatusFilter[]).map((status) => (
                  <button
                    key={status}
                    onClick={() => setStatusFilter(status)}
                    className={`px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-wide transition-colors ${
                      statusFilter === status
                        ? 'bg-primary text-white'
                        : 'bg-gray-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-gray-200 dark:hover:bg-slate-600'
                    }`}
                  >
                    {status}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="lg:hidden p-4 space-y-3">
            {isLoading ? (
              <div className="rounded-xl border border-gray-100 dark:border-slate-700 p-6 text-center text-sm text-slate-500">
                Loading customers...
              </div>
            ) : customers.length === 0 ? (
              <div className="rounded-xl border border-gray-100 dark:border-slate-700 p-6 text-center text-sm text-slate-500">
                No customers found for this filter.
              </div>
            ) : (
              customers.map((customer) => (
                <article key={customer.id} className="rounded-xl border border-gray-100 dark:border-slate-700 bg-white dark:bg-slate-900/30 p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="size-11 rounded-full bg-primary/10 overflow-hidden flex items-center justify-center shrink-0">
                        {customer.avatar ? (
                          <img src={customer.avatar} alt={customer.name} className="size-full object-cover" />
                        ) : (
                          <span className="material-symbols-outlined text-primary">person</span>
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="font-bold text-sm truncate">{customer.name}</p>
                        <p className="text-xs text-slate-500 truncate">{customer.email}</p>
                      </div>
                    </div>
                    <span
                      className={`inline-flex px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide border whitespace-nowrap ${
                        customer.isSuspended
                          ? 'bg-red-100 text-red-700 border-red-200'
                          : 'bg-green-100 text-green-700 border-green-200'
                      }`}
                    >
                      {customer.isSuspended ? 'Suspended' : 'Active'}
                    </span>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <p className="text-slate-500">Phone</p>
                    <p className="text-right font-semibold text-slate-700 dark:text-slate-200">{customer.phoneNumber || 'No phone number'}</p>
                    <p className="text-slate-500">Joined</p>
                    <p className="text-right font-semibold text-slate-700 dark:text-slate-200">{formatDateTime(customer.createdAt)}</p>
                    <p className="text-slate-500">Orders</p>
                    <p className="text-right font-semibold text-slate-700 dark:text-slate-200">{customer.orderCount}</p>
                    <p className="text-slate-500">Total Spent</p>
                    <p className="text-right font-bold text-primary">{formatCurrency(customer.totalSpent || 0)}</p>
                  </div>

                  <button
                    onClick={() => openSuspensionDialog(customer)}
                    className={`mt-4 w-full px-3 py-2 rounded-lg text-xs font-bold ${
                      customer.isSuspended
                        ? 'bg-green-500 hover:bg-green-600 text-white'
                        : 'bg-red-500 hover:bg-red-600 text-white'
                    }`}
                  >
                    {customer.isSuspended ? 'Reactivate Account' : 'Suspend Account'}
                  </button>
                </article>
              ))
            )}
          </div>

          <div className="hidden lg:block overflow-x-auto">
            <table className="w-full min-w-[980px] text-left">
              <thead className="bg-gray-50 dark:bg-slate-700/40">
                <tr>
                  <th className="px-6 py-3 text-xs font-bold uppercase tracking-wider text-slate-500">Customer</th>
                  <th className="px-6 py-3 text-xs font-bold uppercase tracking-wider text-slate-500">Orders</th>
                  <th className="px-6 py-3 text-xs font-bold uppercase tracking-wider text-slate-500">Total Spent</th>
                  <th className="px-6 py-3 text-xs font-bold uppercase tracking-wider text-slate-500">Status</th>
                  <th className="px-6 py-3 text-xs font-bold uppercase tracking-wider text-slate-500 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                {isLoading ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-10 text-center text-slate-500">
                      Loading customers...
                    </td>
                  </tr>
                ) : customers.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-10 text-center text-slate-500">
                      No customers found for this filter.
                    </td>
                  </tr>
                ) : (
                  customers.map((customer) => {
                    return (
                      <tr key={customer.id} className="hover:bg-gray-50 dark:hover:bg-slate-700/30 transition-colors">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="size-11 rounded-full bg-primary/10 overflow-hidden flex items-center justify-center">
                              {customer.avatar ? (
                                <img src={customer.avatar} alt={customer.name} className="size-full object-cover" />
                              ) : (
                                <span className="material-symbols-outlined text-primary">person</span>
                              )}
                            </div>
                            <div>
                              <p className="font-bold text-sm">{customer.name}</p>
                              <p className="text-xs text-slate-500">{customer.email}</p>
                              <p className="text-xs text-slate-400">{customer.phoneNumber || 'No phone number'}</p>
                              <p className="text-[11px] text-slate-400">Joined: {formatDateTime(customer.createdAt)}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-sm font-semibold">{customer.orderCount}</td>
                        <td className="px-6 py-4 text-sm font-bold">{formatCurrency(customer.totalSpent || 0)}</td>
                        <td className="px-6 py-4">
                          <span
                            className={`inline-flex px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide border ${
                              customer.isSuspended
                                ? 'bg-red-100 text-red-700 border-red-200'
                                : 'bg-green-100 text-green-700 border-green-200'
                            }`}
                          >
                            {customer.isSuspended ? 'Suspended' : 'Active'}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <button
                            onClick={() => openSuspensionDialog(customer)}
                            className={`px-3 py-2 rounded-lg text-xs font-bold ml-auto ${
                              customer.isSuspended
                                ? 'bg-green-500 hover:bg-green-600 text-white'
                                : 'bg-red-500 hover:bg-red-600 text-white'
                            }`}
                          >
                            {customer.isSuspended ? 'Reactivate Account' : 'Suspend Account'}
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      {suspensionDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setSuspensionDialog(null)} />
          <div className="relative w-full max-w-md rounded-2xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl p-6">
            <h3 className="text-lg font-extrabold tracking-tight">
              {suspensionDialog.nextSuspended ? 'Suspend Customer Account' : 'Reactivate Customer Account'}
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-300 mt-2">
              {suspensionDialog.nextSuspended
                ? `Suspend ${suspensionDialog.customer.name}? They will no longer be able to place orders until reactivated.`
                : `Reactivate ${suspensionDialog.customer.name}? They will regain access immediately.`}
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setSuspensionDialog(null)}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-gray-100 hover:bg-gray-200 text-gray-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                onClick={confirmSuspensionUpdate}
                disabled={isUpdatingSuspension}
                className={`px-4 py-2 rounded-lg text-sm font-bold text-white ${
                  suspensionDialog.nextSuspended ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'
                } disabled:opacity-60`}
              >
                {isUpdatingSuspension ? 'Updating...' : suspensionDialog.nextSuspended ? 'Suspend Account' : 'Reactivate'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminCustomers;
