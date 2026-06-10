import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';

interface PointsData {
    balance: number;
    transactions: any[];
}

export default function PointsDashboard() {
    const { user, token } = useAuth();
    const navigate = useNavigate();
    const [pointsData, setPointsData] = useState<PointsData | null>(null);
    const [vouchers, setVouchers] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [redeeming, setRedeeming] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!user || !token) {
            navigate('/login');
            return;
        }
        fetchData();
    }, [user, token, navigate]);

    const fetchData = async () => {
        setLoading(true);
        try {
            const [pointsRes, vouchersRes] = await Promise.all([
                fetch('/api/user/points', { headers: { Authorization: `Bearer ${token}` } }),
                fetch('/api/user/vouchers', { headers: { Authorization: `Bearer ${token}` } })
            ]);
            
            if (pointsRes.ok) setPointsData(await pointsRes.json());
            if (vouchersRes.ok) setVouchers(await vouchersRes.json());
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const handleRedeem = async (pointsToRedeem: number) => {
        if (!confirm(`Are you sure you want to redeem ${pointsToRedeem} points for RM${pointsToRedeem / 200}?`)) return;
        
        setRedeeming(true);
        setError('');
        try {
            const res = await fetch('/api/user/points/redeem', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ points: pointsToRedeem })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to redeem');
            
            alert(`Success! Your voucher code is ${data.code}. It has been emailed to you.`);
            fetchData();
        } catch (err: any) {
            setError(err.message);
        } finally {
            setRedeeming(false);
        }
    };

    if (loading) return <div className="p-8 text-center">Loading points data...</div>;

    const balance = pointsData?.balance || 0;

    return (
        <div className="max-w-4xl mx-auto p-4 md:p-8">
            <h1 className="text-3xl font-bold mb-8">My Rewards</h1>
            
            {error && <div className="bg-red-100 text-red-700 p-4 rounded-lg mb-6">{error}</div>}

            <div className="bg-gradient-to-r from-purple-600 to-indigo-600 rounded-2xl p-8 text-white shadow-xl mb-8">
                <p className="text-purple-100 text-sm uppercase tracking-wider mb-2">Available Points</p>
                <div className="text-5xl font-black mb-6">{balance.toLocaleString()} pts</div>
                
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <button 
                        onClick={() => handleRedeem(200)}
                        disabled={balance < 200 || redeeming}
                        className="bg-white/20 hover:bg-white/30 disabled:opacity-50 transition rounded-lg p-4 text-left"
                    >
                        <div className="font-bold text-xl mb-1">RM1 Off</div>
                        <div className="text-sm text-purple-200">Redeem 200 pts</div>
                    </button>
                    <button 
                        onClick={() => handleRedeem(1000)}
                        disabled={balance < 1000 || redeeming}
                        className="bg-white/20 hover:bg-white/30 disabled:opacity-50 transition rounded-lg p-4 text-left"
                    >
                        <div className="font-bold text-xl mb-1">RM5 Off</div>
                        <div className="text-sm text-purple-200">Redeem 1,000 pts</div>
                    </button>
                    <button 
                        onClick={() => handleRedeem(2000)}
                        disabled={balance < 2000 || redeeming}
                        className="bg-white/20 hover:bg-white/30 disabled:opacity-50 transition rounded-lg p-4 text-left"
                    >
                        <div className="font-bold text-xl mb-1">RM10 Off</div>
                        <div className="text-sm text-purple-200">Redeem 2,000 pts</div>
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div>
                    <h2 className="text-xl font-bold mb-4">My Vouchers</h2>
                    {vouchers.length === 0 ? (
                        <p className="text-gray-500">No vouchers yet.</p>
                    ) : (
                        <div className="space-y-4">
                            {vouchers.map(v => (
                                <div key={v.id} className={`border rounded-lg p-4 ${v.is_redeemed || !v.is_active ? 'opacity-50 bg-gray-50' : 'bg-white shadow-sm'}`}>
                                    <div className="flex justify-between items-start mb-2">
                                        <div className="font-mono font-bold text-lg text-indigo-600">{v.code}</div>
                                        <div className="text-sm font-semibold">RM{Number(v.discount_value).toFixed(2)} Off</div>
                                    </div>
                                    <div className="text-xs text-gray-500 flex justify-between">
                                        <span>Expires: {new Date(v.expires_at).toLocaleDateString()}</span>
                                        <span>{v.is_redeemed ? 'Redeemed' : !v.is_active ? 'Inactive' : 'Available'}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div>
                    <h2 className="text-xl font-bold mb-4">Points History</h2>
                    {(!pointsData?.transactions || pointsData.transactions.length === 0) ? (
                        <p className="text-gray-500">No recent transactions.</p>
                    ) : (
                        <div className="bg-white border rounded-xl overflow-hidden">
                            {pointsData.transactions.map((tx, idx) => (
                                <div key={tx.id} className={`p-4 flex justify-between items-center ${idx !== pointsData.transactions.length - 1 ? 'border-b' : ''}`}>
                                    <div>
                                        <div className="font-medium text-sm text-gray-800">{tx.description || tx.transaction_type}</div>
                                        <div className="text-xs text-gray-500">{new Date(tx.created_at).toLocaleString()}</div>
                                    </div>
                                    <div className={`font-bold ${tx.points > 0 ? 'text-green-600' : 'text-red-500'}`}>
                                        {tx.points > 0 ? '+' : ''}{tx.points}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
