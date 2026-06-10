import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import BrandLogo from '../components/BrandLogo';
import AdminMobileNav from '../components/AdminMobileNav';
import AdminSidebarNav from '../components/AdminSidebarNav';
import AdminSidebarFooter from '../components/AdminSidebarFooter';
import { api } from '../services/api';
import { formatCurrency } from '../utils/currency';

export default function AdminVouchers() {
    const [vouchers, setVouchers] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    
    const [stats, setStats] = useState({ today: 0, thisWeek: 0, thisMonth: 0 });
    const [statsLoading, setStatsLoading] = useState(true);
    const [isExporting, setIsExporting] = useState(false);

    // Form State
    const [code, setCode] = useState('');
    const [type, setType] = useState<'fixed' | 'percentage'>('fixed');
    const [discountValue, setDiscountValue] = useState<number | ''>('');
    const [minSpend, setMinSpend] = useState<number | ''>('');
    const [maxDiscount, setMaxDiscount] = useState<number | ''>('');
    const [expiresAt, setExpiresAt] = useState('');
    const [userEmail, setUserEmail] = useState('');

    const location = useLocation();
    const navigate = useNavigate();
    const { logout } = useAuth();

    const handleLogout = () => {
        logout();
        navigate('/admin/login', { replace: true });
    };

    useEffect(() => {
        fetchVouchers();
        fetchStats();
    }, []);

    const fetchStats = async () => {
        setStatsLoading(true);
        try {
            const token = localStorage.getItem('takcakap_auth_token');
            const res = await fetch('/api/admin/vouchers/stats', {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (res.ok) {
                setStats(await res.json());
            }
        } catch (err) {
            console.error(err);
        } finally {
            setStatsLoading(false);
        }
    };

    const fetchVouchers = async () => {
        setLoading(true);
        try {
            const token = localStorage.getItem('takcakap_auth_token');
            const res = await fetch('/api/admin/vouchers', {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (res.ok) {
                setVouchers(await res.json());
            }
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const handleExportCsv = async () => {
        setIsExporting(true);
        try {
            const token = localStorage.getItem('takcakap_auth_token');
            const res = await fetch('/api/admin/vouchers/export', {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!res.ok) throw new Error('Failed to export CSV');
            
            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
            link.href = url;
            link.download = `vouchers-audit-${stamp}.csv`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(url);
        } catch (err) {
            console.error('Export error:', err);
            alert('Failed to export CSV. Please try again.');
        } finally {
            setIsExporting(false);
        }
    };

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        setCreating(true);
        try {
            const token = localStorage.getItem('takcakap_auth_token');
            const payload = {
                code,
                type,
                discount_value: Number(discountValue),
                min_spend: minSpend ? Number(minSpend) : 0,
                max_discount: maxDiscount ? Number(maxDiscount) : null,
                expires_at: new Date(expiresAt).toISOString(),
                user_email: userEmail || null
            };
            const res = await fetch('/api/admin/vouchers', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            alert('Voucher created');
            setCode('');
            setDiscountValue('');
            setMinSpend('');
            setMaxDiscount('');
            setExpiresAt('');
            setUserEmail('');
            fetchVouchers();
        } catch (err: any) {
            alert(err.message);
        } finally {
            setCreating(false);
        }
    };

    const handleToggle = async (id: number) => {
        try {
            const token = localStorage.getItem('takcakap_auth_token');
            await fetch(`/api/admin/vouchers/${id}/toggle`, {
                method: 'PUT',
                headers: { Authorization: `Bearer ${token}` }
            });
            fetchVouchers();
        } catch (err) {
            console.error(err);
        }
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
                
                <header className="mb-8 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div>
                        <h2 className="text-3xl font-extrabold tracking-tight">Voucher Management</h2>
                        <p className="text-slate-500">Manage promotional codes and track redemptions.</p>
                    </div>
                    <div className="w-full xl:w-auto flex flex-col gap-2">
                        <button
                            onClick={handleExportCsv}
                            disabled={isExporting}
                            className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-primary text-white text-sm font-bold hover:bg-primary/90 disabled:opacity-60"
                        >
                            <span className="material-symbols-outlined text-base">download</span>
                            {isExporting ? 'Exporting...' : 'Export Audit CSV'}
                        </button>
                    </div>
                </header>

                {/* Dashboard Stats */}
                <section className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
                    <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-primary/10 shadow-sm relative overflow-hidden">
                        <div className="flex justify-between items-start mb-4 gap-2">
                            <div>
                                <p className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Redeemed Today</p>
                                <h3 className="text-3xl font-bold mt-1 text-[#0d1c0d] dark:text-white">
                                    {statsLoading ? '...' : formatCurrency(stats.today)}
                                </h3>
                            </div>
                        </div>
                    </div>
                    <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-primary/10 shadow-sm relative overflow-hidden">
                        <div className="flex justify-between items-start mb-4 gap-2">
                            <div>
                                <p className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Redeemed This Week</p>
                                <h3 className="text-3xl font-bold mt-1 text-[#0d1c0d] dark:text-white">
                                    {statsLoading ? '...' : formatCurrency(stats.thisWeek)}
                                </h3>
                            </div>
                        </div>
                    </div>
                    <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-primary/10 shadow-sm relative overflow-hidden">
                        <div className="flex justify-between items-start mb-4 gap-2">
                            <div>
                                <p className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Redeemed This Month</p>
                                <h3 className="text-3xl font-bold mt-1 text-[#0d1c0d] dark:text-white">
                                    {statsLoading ? '...' : formatCurrency(stats.thisMonth)}
                                </h3>
                            </div>
                        </div>
                    </div>
                </section>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <div className="lg:col-span-2 bg-white dark:bg-white/5 border border-[#e7f4e7] dark:border-white/10 rounded-xl overflow-hidden shadow-sm">
                        <div className="px-6 py-4 border-b border-[#e7f4e7] dark:border-white/10 font-bold">All Vouchers</div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left">
                                <thead className="bg-[#f8fcf8] dark:bg-white/5 text-xs font-bold uppercase tracking-wider text-[#499c49]">
                                    <tr>
                                        <th className="px-6 py-4">Code</th>
                                        <th className="px-6 py-4">Value</th>
                                        <th className="px-6 py-4">Min Spend</th>
                                        <th className="px-6 py-4">Expires</th>
                                        <th className="px-6 py-4 text-center">Status</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-[#e7f4e7] dark:divide-white/10">
                                    {loading ? (
                                        <tr><td colSpan={5} className="p-6 text-center text-gray-500">Loading...</td></tr>
                                    ) : vouchers.map(v => (
                                        <tr key={v.id} className={v.is_redeemed ? 'opacity-50' : ''}>
                                            <td className="px-6 py-4">
                                                <div className="font-bold tracking-wide">{v.code}</div>
                                                {v.user_name && <div className="text-xs text-gray-500">For: {v.user_name}</div>}
                                            </td>
                                            <td className="px-6 py-4 font-bold text-primary">
                                                {v.type === 'fixed' ? formatCurrency(v.discount_value) : `${v.discount_value}%`}
                                                {v.max_discount && <div className="text-xs text-gray-500">Max: {formatCurrency(v.max_discount)}</div>}
                                            </td>
                                            <td className="px-6 py-4">{formatCurrency(v.min_spend)}</td>
                                            <td className="px-6 py-4 text-sm">{new Date(v.expires_at).toLocaleDateString()}</td>
                                            <td className="px-6 py-4 text-center">
                                                {v.is_redeemed ? (
                                                    <span className="bg-gray-100 text-gray-500 px-2 py-1 rounded text-xs font-bold">Redeemed</span>
                                                ) : (
                                                    <button
                                                        type="button"
                                                        title={v.is_active ? "Click to Deactivate" : "Click to Activate"}
                                                        onClick={() => handleToggle(v.id)}
                                                        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
                                                            v.is_active ? 'bg-primary' : 'bg-gray-200 dark:bg-slate-700'
                                                        }`}
                                                    >
                                                        <span className="sr-only">Toggle voucher status</span>
                                                        <span
                                                            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                                                                v.is_active ? 'translate-x-5' : 'translate-x-0'
                                                            }`}
                                                        />
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div>
                        <div className="bg-white dark:bg-white/5 border border-[#e7f4e7] dark:border-white/10 rounded-xl p-6 shadow-sm sticky top-24">
                            <h2 className="text-xl font-bold mb-4">Create Voucher</h2>
                            <form onSubmit={handleCreate} className="space-y-4">
                                <div>
                                    <label className="block text-sm font-bold mb-1">Voucher Code</label>
                                    <input required type="text" value={code} onChange={e => setCode(e.target.value.toUpperCase())} className="w-full bg-white dark:bg-white/5 border border-[#e7f4e7] dark:border-white/10 rounded-lg px-4 py-2 uppercase" placeholder="e.g. SUMMER2023" />
                                </div>
                                <div>
                                    <label className="block text-sm font-bold mb-1">Discount Type</label>
                                    <select value={type} onChange={e => setType(e.target.value as any)} className="w-full bg-white dark:bg-white/5 border border-[#e7f4e7] dark:border-white/10 rounded-lg px-4 py-2">
                                        <option value="fixed">Fixed Amount (RM)</option>
                                        <option value="percentage">Percentage (%)</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-bold mb-1">Discount Value</label>
                                    <input required type="number" step="0.01" min="0.01" value={discountValue} onChange={e => setDiscountValue(Number(e.target.value))} className="w-full bg-white dark:bg-white/5 border border-[#e7f4e7] dark:border-white/10 rounded-lg px-4 py-2" placeholder="e.g. 10" />
                                </div>
                                {type === 'percentage' && (
                                    <div>
                                        <label className="block text-sm font-bold mb-1">Max Discount (RM) - Optional</label>
                                        <input type="number" step="0.01" min="0" value={maxDiscount} onChange={e => setMaxDiscount(Number(e.target.value))} className="w-full bg-white dark:bg-white/5 border border-[#e7f4e7] dark:border-white/10 rounded-lg px-4 py-2" placeholder="e.g. 50" />
                                    </div>
                                )}
                                <div>
                                    <label className="block text-sm font-bold mb-1">Minimum Spend (RM)</label>
                                    <input type="number" step="0.01" min="0" value={minSpend} onChange={e => setMinSpend(Number(e.target.value))} className="w-full bg-white dark:bg-white/5 border border-[#e7f4e7] dark:border-white/10 rounded-lg px-4 py-2" placeholder="e.g. 30" />
                                </div>
                                <div>
                                    <label className="block text-sm font-bold mb-1">Expiry Date</label>
                                    <input required type="date" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} className="w-full bg-white dark:bg-white/5 border border-[#e7f4e7] dark:border-white/10 rounded-lg px-4 py-2" />
                                </div>
                                <div>
                                    <label className="block text-sm font-bold mb-1">Specific User Email (Optional)</label>
                                    <input type="email" value={userEmail} onChange={e => setUserEmail(e.target.value)} className="w-full bg-white dark:bg-white/5 border border-[#e7f4e7] dark:border-white/10 rounded-lg px-4 py-2" placeholder="Leave blank for public voucher" />
                                </div>
                                <button disabled={creating} type="submit" className="w-full bg-primary text-background-dark font-bold rounded-lg py-3 hover:bg-primary/90 disabled:opacity-50 mt-4">
                                    {creating ? 'Creating...' : 'Create Voucher'}
                                </button>
                            </form>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}
