import React, { useEffect, useState } from 'react';
import { api } from '../services/api';

export default function AdminPoints() {
    const [users, setUsers] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [adjusting, setAdjusting] = useState(false);
    
    const [selectedUser, setSelectedUser] = useState<any>(null);
    const [action, setAction] = useState<'add' | 'deduct'>('add');
    const [points, setPoints] = useState<number | ''>('');
    const [description, setDescription] = useState('');

    useEffect(() => {
        fetchUsers();
    }, []);

    const fetchUsers = async () => {
        setLoading(true);
        try {
            const token = localStorage.getItem('takcakap_admin_token');
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
            const token = localStorage.getItem('takcakap_admin_token');
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
        } catch (err: any) {
            alert(err.message);
        } finally {
            setAdjusting(false);
        }
    };

    return (
        <div className="p-6 md:p-10 max-w-[1440px] mx-auto w-full text-[#0d1c0d] dark:text-white">
            <h1 className="text-3xl font-bold mb-8">Points Management</h1>

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
                                ) : users.map(u => (
                                    <tr key={u.id}>
                                        <td className="px-6 py-4 font-bold">{u.name}</td>
                                        <td className="px-6 py-4">{u.email}</td>
                                        <td className="px-6 py-4 text-right font-bold text-primary">{u.points_balance} pts</td>
                                        <td className="px-6 py-4 text-center">
                                            <button 
                                                onClick={() => setSelectedUser(u)}
                                                className="bg-primary/10 text-primary px-3 py-1.5 rounded-md font-bold text-sm hover:bg-primary/20"
                                            >
                                                Adjust
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
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
                                    <button type="button" onClick={() => setAction('add')} className={`py-2 rounded-lg font-bold border ${action === 'add' ? 'bg-green-100 border-green-500 text-green-700' : 'bg-white'}`}>Add</button>
                                    <button type="button" onClick={() => setAction('deduct')} className={`py-2 rounded-lg font-bold border ${action === 'deduct' ? 'bg-red-100 border-red-500 text-red-700' : 'bg-white'}`}>Deduct</button>
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
                                <button type="button" onClick={() => setSelectedUser(null)} className="w-full font-bold text-gray-500 py-2">Cancel</button>
                            </form>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
