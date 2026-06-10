import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import BrandLogo from '../components/BrandLogo';
import AdminMobileNav from '../components/AdminMobileNav';
import AdminSidebarNav from '../components/AdminSidebarNav';
import AdminSidebarFooter from '../components/AdminSidebarFooter';
import { formatCurrency } from '../utils/currency';

export default function AdminPoints() {
    const [users, setUsers] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [adjusting, setAdjusting] = useState(false);
    const [page, setPage] = useState(1);
    const PAGE_SIZE = 15;
    
    const [selectedUser, setSelectedUser] = useState<any>(null);
    const [action, setAction] = useState<'add' | 'deduct'>('add');
    const [points, setPoints] = useState<number | ''>('');
    const [description, setDescription] = useState('');

    const [stats, setStats] = useState({ totalDistributed: 0, estValueRM: 0 });
    const [statsLoading, setStatsLoading] = useState(true);

    const location = useLocation();
    const navigate = useNavigate();
    const { logout } = useAuth();

    const handleLogout = () => {
        logout();
        navigate('/admin/login', { replace: true });
    };

    useEffect(() => {
        fetchUsers();
        fetchStats();
    }, []);

    const fetchStats = async () => {
        setStatsLoading(true);
        try {
            const token = localStorage.getItem('takcakap_auth_token');
            const res = await fetch('/api/admin/points/stats', {
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

    const fetchUsers = async () => {
        setLoading(true);
        try {
            const token = localStorage.getItem('takcakap_auth_token');
            const res = await fetch('/api/admin/points/users', {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (res.ok) {
                setUsers(await res.json());
            }
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const handleAdjust = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedUser || !points || points <= 0) return;
        setAdjusting(true);
        try {
            const token = localStorage.getItem('takcakap_auth_token');
            const res = await fetch('/api/admin/points/adjust', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({
                    userId: selectedUser.id,
                    points: Number(points),
                    action,
                    description
                })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            alert('Points adjusted successfully');
            setSelectedUser(null);
            setPoints('');
            setDescription('');
            fetchUsers();
            fetchStats();
        } catch (err: any) {
            alert(err.message);
        } finally {
            setAdjusting(false);
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
                
                <header className="mb-8">
                    <h2 className="text-3xl font-extrabold tracking-tight">Points Management</h2>
                    <p className="text-slate-500">Manage user points and view overall distribution.</p>
                </header>

                {/* Dashboard Stats */}
                <section className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-10">
                    <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-primary/10 shadow-sm relative overflow-hidden">
                        <div className="flex justify-between items-start mb-4 gap-2">
                            <div>
                                <p className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Total Distributed Coins</p>
                                <h3 className="text-3xl font-bold mt-1 text-[#b49820]">
                                    {statsLoading ? '...' : stats.totalDistributed.toLocaleString()} pts
                                </h3>
                            </div>
                            <span className="material-symbols-outlined text-4xl text-yellow-400 opacity-50">stars</span>
                        </div>
                    </div>
                    <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-primary/10 shadow-sm relative overflow-hidden">
                        <div className="flex justify-between items-start mb-4 gap-2">
                            <div>
                                <p className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Estimated Value (RM)</p>
                                <h3 className="text-3xl font-bold mt-1 text-primary">
                                    {statsLoading ? '...' : formatCurrency(stats.estValueRM)}
                                </h3>
                            </div>
                            <span className="material-symbols-outlined text-4xl text-primary opacity-50">payments</span>
                        </div>
                    </div>
                </section>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <div className="lg:col-span-2 bg-white dark:bg-white/5 border border-[#e7f4e7] dark:border-white/10 rounded-xl overflow-hidden shadow-sm">
                        <div className="px-6 py-4 border-b border-[#e7f4e7] dark:border-white/10 font-bold">Customer Balances</div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left">
                                <thead className="bg-[#f8fcf8] dark:bg-white/5 text-xs font-bold uppercase tracking-wider text-[#499c49]">
                                    <tr>
                                        <th className="px-6 py-4">Customer</th>
                                        <th className="px-6 py-4">Email</th>
                                        <th className="px-6 py-4 text-right">Points Balance</th>
                                        <th className="px-6 py-4 text-center">Action</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-[#e7f4e7] dark:divide-white/10">
                                    {loading ? (
                                        <tr><td colSpan={4} className="p-6 text-center text-gray-500">Loading...</td></tr>
                                    ) : (() => {
                                        const totalPages = Math.max(1, Math.ceil(users.length / PAGE_SIZE));
                                        const currentUsers = users.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
                                        return currentUsers.map(u => (
                                        <tr key={u.id}>
                                            <td className="px-6 py-4 font-bold">{u.name}</td>
                                            <td className="px-6 py-4">{u.email}</td>
                                            <td className="px-6 py-4 text-right font-bold text-[#b49820]">{u.points_balance} pts</td>
                                            <td className="px-6 py-4 text-center">
                                                <button 
                                                    onClick={() => setSelectedUser(u)}
                                                    className="bg-primary/10 text-primary px-3 py-1.5 rounded-md font-bold text-sm hover:bg-primary/20"
                                                >
                                                    Adjust
                                                </button>
                                            </td>
                                        </tr>
                                        ));
                                    })()}
                                </tbody>
                            </table>
                        </div>
                        {!loading && users.length > 0 && (
                            <div className="px-6 py-4 border-t border-[#e7f4e7] dark:border-white/10 flex justify-between items-center bg-gray-50 dark:bg-white/5">
                                <button
                                    onClick={() => setPage(p => Math.max(1, p - 1))}
                                    disabled={page === 1}
                                    className="px-4 py-2 border border-gray-300 rounded-lg text-sm disabled:opacity-50"
                                >
                                    Previous
                                </button>
                                <span className="text-sm font-semibold">
                                    Page {page} of {Math.max(1, Math.ceil(users.length / PAGE_SIZE))}
                                </span>
                                <button
                                    onClick={() => setPage(p => Math.min(Math.ceil(users.length / PAGE_SIZE), p + 1))}
                                    disabled={page === Math.max(1, Math.ceil(users.length / PAGE_SIZE))}
                                    className="px-4 py-2 border border-gray-300 rounded-lg text-sm disabled:opacity-50"
                                >
                                    Next
                                </button>
                            </div>
                        )}
                    </div>

                    <div>
                        <div className="bg-white dark:bg-white/5 border border-[#e7f4e7] dark:border-white/10 rounded-xl p-6 shadow-sm sticky top-24">
                            <h2 className="text-xl font-bold mb-4">Adjust Points</h2>
                            {!selectedUser ? (
                                <div className="text-gray-500 text-sm text-center py-8">Select a customer to adjust their points.</div>
                            ) : (
                                <form onSubmit={handleAdjust} className="space-y-4">
                                    <div>
                                        <label className="block text-sm font-bold mb-1">Customer</label>
                                        <div className="p-3 bg-gray-50 dark:bg-white/5 rounded-lg border font-medium">
                                            {selectedUser.name} ({selectedUser.points_balance} pts)
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                        <button type="button" onClick={() => setAction('add')} className={`py-2 rounded-lg font-bold border ${action === 'add' ? 'bg-green-100 border-green-500 text-green-700' : 'bg-white text-gray-700'}`}>Add</button>
                                        <button type="button" onClick={() => setAction('deduct')} className={`py-2 rounded-lg font-bold border ${action === 'deduct' ? 'bg-red-100 border-red-500 text-red-700' : 'bg-white text-gray-700'}`}>Deduct</button>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-bold mb-1">Amount</label>
                                        <input required type="number" min="1" value={points} onChange={e => setPoints(Number(e.target.value))} className="w-full bg-white dark:bg-white/5 border border-[#e7f4e7] dark:border-white/10 rounded-lg px-4 py-2" placeholder="e.g. 500" />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-bold mb-1">Description (Optional)</label>
                                        <input type="text" value={description} onChange={e => setDescription(e.target.value)} className="w-full bg-white dark:bg-white/5 border border-[#e7f4e7] dark:border-white/10 rounded-lg px-4 py-2" placeholder="e.g. Goodwill credit" />
                                    </div>
                                    <button disabled={adjusting || !points || points <= 0} type="submit" className="w-full bg-primary text-background-dark font-bold rounded-lg py-3 hover:bg-primary/90 disabled:opacity-50 mt-4">
                                        {adjusting ? 'Processing...' : 'Confirm'}
                                    </button>
                                    <button type="button" onClick={() => setSelectedUser(null)} className="w-full font-bold text-gray-500 py-2 hover:text-gray-700">Cancel</button>
                                </form>
                            )}
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}
