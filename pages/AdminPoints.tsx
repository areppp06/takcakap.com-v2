import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import BrandLogo from '../components/BrandLogo';
import AdminMobileNav from '../components/AdminMobileNav';
import AdminSidebarNav from '../components/AdminSidebarNav';
import AdminSidebarFooter from '../components/AdminSidebarFooter';
import { formatCurrency } from '../utils/currency';
import { api } from '../services/api';

export default function AdminPoints() {
    const [users, setUsers] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [adjusting, setAdjusting] = useState(false);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const PAGE_SIZE = 15;
    
    const [selectedUser, setSelectedUser] = useState<any>(null);
    const [action, setAction] = useState<'add' | 'deduct'>('add');
    const [points, setPoints] = useState<number | ''>('');
    const [description, setDescription] = useState('');

    const [stats, setStats] = useState({ circulatingCoin: 0, estValueRM: 0 });
    const [statsLoading, setStatsLoading] = useState(true);

    const [cooldownHours, setCooldownHours] = useState(12);
    const [confirmText, setConfirmText] = useState('');
    const [savingCooldown, setSavingCooldown] = useState(false);

    const [tiers, setTiers] = useState<any[]>([]);
    const [tiersLoading, setTiersLoading] = useState(true);
    const [tierModalOpen, setTierModalOpen] = useState(false);
    const [editingTier, setEditingTier] = useState<any>(null);

    const location = useLocation();
    const navigate = useNavigate();
    const { logout } = useAuth();

    const handleLogout = () => {
        logout();
        navigate('/admin/login', { replace: true });
    };

    useEffect(() => {
        fetchUsers(page);
    }, [page]);

    useEffect(() => {
        fetchStats();
        fetchTiers();
        fetchCooldown();
    }, []);

    const fetchCooldown = async () => {
        try {
            const data = await api.getAdminPointsSettings();
            setCooldownHours(data.voucher_cooldown_hours);
        } catch (err) {
            console.error(err);
        }
    };

    const fetchTiers = async () => {
        setTiersLoading(true);
        try {
            setTiers(await api.getAdminPointTiers());
        } catch (err) {
            console.error(err);
        } finally {
            setTiersLoading(false);
        }
    };

    const fetchStats = async () => {
        setStatsLoading(true);
        try {
            setStats(await api.getAdminPointsStats());
        } catch (err) {
            console.error(err);
        } finally {
            setStatsLoading(false);
        }
    };

    const fetchUsers = async (p: number = 1) => {
        setLoading(true);
        try {
            const data = await api.getAdminPointsUsers({ page: p, limit: PAGE_SIZE });
            setUsers(data.users || []);
            setTotalPages(data.totalPages || 1);
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
            const result = await api.adjustAdminPoints({
                userId: selectedUser.id,
                points: Number(points),
                action,
                description
            });
            const nextBalance = result?.balance;
            const debt = result?.debtPoints || 0;
            if (typeof nextBalance === 'number' && debt > 0) {
                alert(`Points adjusted. New balance: ${nextBalance} pts (debt: ${debt}). Redemptions and vouchers are frozen until cleared.`);
            } else if (typeof nextBalance === 'number') {
                alert(`Points adjusted successfully. New balance: ${nextBalance} pts.`);
            } else {
                alert('Points adjusted successfully');
            }
            setSelectedUser(null);
            setPoints('');
            setDescription('');
            fetchUsers(page);
            fetchStats();
        } catch (err: any) {
            alert(err.message);
        } finally {
            setAdjusting(false);
        }
    };

    const handleSaveTier = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!editingTier) return;
        try {
            if (editingTier.id) {
                await api.updateAdminPointTier(editingTier.id, editingTier);
            } else {
                await api.createAdminPointTier(editingTier);
            }
            setTierModalOpen(false);
            fetchTiers();
        } catch (err) {
            console.error(err);
            alert('Failed to save tier');
        }
    };

    const handleDeleteTier = async (id: string) => {
        if (!confirm('Are you sure you want to delete this tier?')) return;
        try {
            await api.deleteAdminPointTier(id);
            fetchTiers();
        } catch (err) {
            console.error(err);
        }
    };

    const handleSaveCooldown = async () => {
        if (confirmText !== 'CONFIRM') return;
        setSavingCooldown(true);
        try {
            await api.updateAdminPointsSettings({ voucher_cooldown_hours: cooldownHours });
            alert('Cooldown limit updated successfully!');
            setConfirmText('');
        } catch (err) {
            console.error(err);
            alert('Failed to update cooldown limit');
        } finally {
            setSavingCooldown(false);
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
                                <p className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Current Circulating Coin</p>
                                <h3 className="text-3xl font-bold mt-1 text-[#b49820]">
                                    {statsLoading ? '...' : stats.circulatingCoin.toLocaleString()} pts
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

                <section className="mb-10">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-xl font-bold">Voucher Redemption Tiers</h3>
                        <button onClick={() => { setEditingTier({ points_required: '', discount_amount: '', is_active: true }); setTierModalOpen(true); }} className="bg-primary hover:bg-primary-dark text-white px-4 py-2 rounded-lg font-bold text-sm shadow-sm transition-colors">
                            Add Tier
                        </button>
                    </div>
                    <div className="bg-white dark:bg-slate-800 border border-[#e7f4e7] dark:border-white/10 rounded-xl overflow-hidden shadow-sm">
                        <table className="w-full text-left">
                            <thead className="bg-[#f8fcf8] dark:bg-white/5 text-xs font-bold uppercase tracking-wider text-[#499c49]">
                                <tr>
                                    <th className="px-6 py-4">Points Required</th>
                                    <th className="px-6 py-4">Discount (RM)</th>
                                    <th className="px-6 py-4">Status</th>
                                    <th className="px-6 py-4 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[#e7f4e7] dark:divide-white/10">
                                {tiersLoading ? (
                                    <tr><td colSpan={4} className="p-6 text-center text-gray-500">Loading tiers...</td></tr>
                                ) : tiers.map(tier => (
                                    <tr key={tier.id}>
                                        <td className="px-6 py-4 font-bold">{tier.points_required} pts</td>
                                        <td className="px-6 py-4 font-bold text-primary">{formatCurrency(tier.discount_amount)}</td>
                                        <td className="px-6 py-4">
                                            <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase ${tier.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                                {tier.is_active ? 'Active' : 'Inactive'}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-right space-x-3">
                                            <button onClick={() => { setEditingTier(tier); setTierModalOpen(true); }} className="text-blue-600 hover:underline text-sm font-bold">Edit</button>
                                            <button onClick={() => handleDeleteTier(tier.id)} className="text-red-600 hover:underline text-sm font-bold">Delete</button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>

                <section className="mb-10">
                    <h3 className="text-xl font-bold mb-4">Redemption Rules</h3>
                    <div className="bg-white dark:bg-slate-800 border border-[#e7f4e7] dark:border-white/10 rounded-xl p-6 shadow-sm">
                        <div className="max-w-md">
                            <label className="block text-sm font-bold mb-2">Voucher Cooldown Limit (Hours)</label>
                            <p className="text-sm text-gray-500 mb-4">Users can only redeem one voucher every X hours. Set to 0 to disable.</p>
                            
                            <input 
                                type="number" 
                                min="0"
                                className="w-full border rounded-lg p-2 mb-4 dark:bg-slate-700 dark:border-slate-600"
                                value={cooldownHours}
                                onChange={e => setCooldownHours(Number(e.target.value))}
                            />

                            <label className="block text-sm font-bold mb-2">Type "CONFIRM" to save</label>
                            <input 
                                type="text" 
                                className="w-full border rounded-lg p-2 mb-4 dark:bg-slate-700 dark:border-slate-600"
                                value={confirmText}
                                onChange={e => setConfirmText(e.target.value)}
                                placeholder="CONFIRM"
                            />

                            <button 
                                onClick={handleSaveCooldown}
                                disabled={confirmText !== 'CONFIRM' || savingCooldown}
                                className="bg-primary text-white font-bold py-2 px-6 rounded-lg disabled:opacity-50 transition-opacity"
                            >
                                {savingCooldown ? 'Processing...' : 'Save Changes'}
                            </button>
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
                                    ) : (
                                        users.map(u => (
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
                                        ))
                                    )}
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
                                    {action === 'deduct' && (
                                        <p className="text-xs text-amber-700">
                                            Deduction may create a points debt. Redemptions and vouchers freeze until cleared.
                                        </p>
                                    )}
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
            {/* Adjust Points Modal */}
            {selectedUser && (
                <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-md p-6">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-xl font-bold text-slate-900 dark:text-white">Adjust Points</h3>
                            <button onClick={() => setSelectedUser(null)} className="text-slate-400 hover:text-slate-600 dark:hover:text-white">
                                <span className="material-symbols-outlined">close</span>
                            </button>
                        </div>
                        
                        <div className="mb-4">
                            <p className="text-sm text-slate-500 dark:text-slate-400">Customer</p>
                            <p className="font-bold">{selectedUser.name} <span className="text-sm font-normal text-slate-500">({selectedUser.email})</span></p>
                            <p className="text-sm mt-1">Current Balance: <strong className="text-[#b49820]">{selectedUser.points_balance} pts</strong></p>
                        </div>

                        <form onSubmit={handleAdjust} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium mb-1">Action</label>
                                <div className="flex gap-4">
                                    <label className="flex items-center gap-2">
                                        <input type="radio" checked={action === 'add'} onChange={() => setAction('add')} />
                                        <span>Add Points</span>
                                    </label>
                                    <label className="flex items-center gap-2">
                                        <input type="radio" checked={action === 'deduct'} onChange={() => setAction('deduct')} />
                                        <span>Deduct Points</span>
                                    </label>
                                </div>
                                {action === 'deduct' && (
                                    <p className="text-xs text-amber-700 mt-2">
                                        Deduction may create a points debt. Redemptions and vouchers freeze until cleared by future purchases.
                                    </p>
                                )}
                            </div>
                            
                            <div>
                                <label className="block text-sm font-medium mb-1">Points Amount</label>
                                <input 
                                    type="number" 
                                    min="1"
                                    required
                                    className="w-full border rounded-lg p-2 dark:bg-slate-700 dark:border-slate-600"
                                    value={points}
                                    onChange={e => setPoints(e.target.value ? Number(e.target.value) : '')}
                                    placeholder="e.g. 100"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium mb-1">Description / Reason</label>
                                <input 
                                    type="text" 
                                    required
                                    className="w-full border rounded-lg p-2 dark:bg-slate-700 dark:border-slate-600"
                                    value={description}
                                    onChange={e => setDescription(e.target.value)}
                                    placeholder="e.g. Compensation for delayed order"
                                />
                            </div>

                            <div className="flex gap-3 pt-4">
                                <button 
                                    type="button" 
                                    onClick={() => setSelectedUser(null)}
                                    className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-2 rounded-lg"
                                >
                                    Cancel
                                </button>
                                <button 
                                    type="submit" 
                                    disabled={adjusting || !points || points <= 0 || !description}
                                    className={`flex-1 font-bold py-2 rounded-lg text-white ${action === 'add' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'} disabled:opacity-50`}
                                >
                                    {adjusting ? 'Processing...' : 'Confirm'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Tier Edit Modal */}
            {tierModalOpen && editingTier && (
                <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-md p-6">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-xl font-bold text-slate-900 dark:text-white">{editingTier.id ? 'Edit Tier' : 'Add Tier'}</h3>
                            <button onClick={() => setTierModalOpen(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-white">
                                <span className="material-symbols-outlined">close</span>
                            </button>
                        </div>
                        
                        <form onSubmit={handleSaveTier} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium mb-1">Points Required</label>
                                <input 
                                    type="number" 
                                    min="1"
                                    required
                                    className="w-full border rounded-lg p-2 dark:bg-slate-700 dark:border-slate-600"
                                    value={editingTier.points_required}
                                    onChange={e => setEditingTier({...editingTier, points_required: Number(e.target.value)})}
                                    placeholder="e.g. 200"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium mb-1">Discount Amount (RM)</label>
                                <input 
                                    type="number" 
                                    step="0.01"
                                    min="0.01"
                                    required
                                    className="w-full border rounded-lg p-2 dark:bg-slate-700 dark:border-slate-600"
                                    value={editingTier.discount_amount}
                                    onChange={e => setEditingTier({...editingTier, discount_amount: Number(e.target.value)})}
                                    placeholder="e.g. 1.00"
                                />
                            </div>

                            <div>
                                <label className="flex items-center gap-2">
                                    <input 
                                        type="checkbox" 
                                        checked={editingTier.is_active}
                                        onChange={e => setEditingTier({...editingTier, is_active: e.target.checked})}
                                        className="w-4 h-4 text-primary rounded"
                                    />
                                    <span className="text-sm font-medium">Active (Visible to users)</span>
                                </label>
                            </div>

                            <div className="flex gap-3 pt-4">
                                <button 
                                    type="button" 
                                    onClick={() => setTierModalOpen(false)}
                                    className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-2 rounded-lg"
                                >
                                    Cancel
                                </button>
                                <button 
                                    type="submit" 
                                    className="flex-1 bg-primary hover:bg-primary-dark font-bold py-2 rounded-lg text-white"
                                >
                                    Save
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
