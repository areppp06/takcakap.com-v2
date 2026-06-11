import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import UserDashboardLayout from '../components/UserDashboardLayout';

interface PointsData {
    balance: number;
    transactions: any[];
    totalTransactions: number;
}

export default function PointsDashboard() {
    const { user, token } = useAuth();
    const navigate = useNavigate();
    const [pointsData, setPointsData] = useState<PointsData | null>(null);
    const [vouchers, setVouchers] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [redeeming, setRedeeming] = useState(false);
    const [error, setError] = useState('');
    const [confirmRedeem, setConfirmRedeem] = useState<number | null>(null);
    const [successCode, setSuccessCode] = useState<string | null>(null);
    const [vouchersPage, setVouchersPage] = useState(1);
    const [historyPage, setHistoryPage] = useState(1);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [totalSaved, setTotalSaved] = useState<number>(0);
    
    const VOUCHERS_PER_PAGE = 4;
    const HISTORY_PER_PAGE = 10;

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
            const [pointsRes, vouchersRes, savingsRes] = await Promise.all([
                fetch(`/api/user/points?page=1&limit=${HISTORY_PER_PAGE}`, { headers: { Authorization: `Bearer ${token}` } }),
                fetch('/api/user/vouchers', { headers: { Authorization: `Bearer ${token}` } }),
                fetch('/api/user/vouchers/savings', { headers: { Authorization: `Bearer ${token}` } })
            ]);
            
            if (pointsRes.ok) {
                setPointsData(await pointsRes.json());
                setHistoryPage(1);
            }
            if (vouchersRes.ok) setVouchers(await vouchersRes.json());
            if (savingsRes.ok) {
                const s = await savingsRes.json();
                setTotalSaved(s.totalSaved || 0);
            }
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const loadMoreHistory = async () => {
        if (historyLoading || !pointsData) return;
        const nextPage = historyPage + 1;
        setHistoryLoading(true);
        try {
            const res = await fetch(`/api/user/points?page=${nextPage}&limit=${HISTORY_PER_PAGE}`, { headers: { Authorization: `Bearer ${token}` } });
            if (res.ok) {
                const data = await res.json();
                setPointsData(prev => prev ? { ...prev, transactions: [...prev.transactions, ...data.transactions] } : data);
                setHistoryPage(nextPage);
            }
        } catch (err) {
            console.error(err);
        } finally {
            setHistoryLoading(false);
        }
    };

    const handleRedeemClick = (points: number) => {
        setConfirmRedeem(points);
    };

    const executeRedeem = async () => {
        if (!confirmRedeem) return;
        const pointsToRedeem = confirmRedeem;
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
            
            setConfirmRedeem(null);
            setSuccessCode(data.code);
            fetchData();
        } catch (err: any) {
            setError(err.message);
            setConfirmRedeem(null);
        } finally {
            setRedeeming(false);
        }
    };

    const handleCopy = (code: string) => {
        navigator.clipboard.writeText(code);
        alert('Copied to clipboard!');
    };

    if (loading) return <div className="p-8 text-center">Loading points data...</div>;

    const balance = pointsData?.balance || 0;
    
    const displayVouchers = vouchers.filter(v => v.is_active && !v.is_redeemed && (!v.expires_at || new Date(v.expires_at) > new Date()));
    const totalVoucherPages = Math.max(1, Math.ceil(displayVouchers.length / VOUCHERS_PER_PAGE));
    const currentVouchers = displayVouchers.slice((vouchersPage - 1) * VOUCHERS_PER_PAGE, vouchersPage * VOUCHERS_PER_PAGE);

    const transactions = pointsData?.transactions || [];
    const hasMoreHistory = transactions.length < (pointsData?.totalTransactions || 0);

    return (
        <UserDashboardLayout>
            <h1 className="text-3xl font-bold mb-4 text-gray-900 dark:text-white">My Rewards</h1>
            
            {error && <div className="bg-red-100 text-red-700 p-4 rounded-lg mb-6">{error}</div>}

            <div className="flex flex-col lg:flex-row gap-8">
                {/* Left Column: Banner, Redeem Cards, Vouchers */}
                <div className="flex-1">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                        {/* Banner */}
                        <div className="bg-gradient-to-r from-purple-600 to-fuchsia-600 rounded-xl p-6 text-white shadow-md flex flex-col justify-center">
                            <p className="opacity-90 text-xs font-bold uppercase tracking-wider mb-1">Total Points</p>
                            <div className="text-3xl md:text-4xl font-extrabold">{balance.toLocaleString()} pts</div>
                            <p className="text-sm font-medium mt-1 opacity-90">≈ RM {(balance / 200).toFixed(2)} (RM1 = 200 pts)</p>
                        </div>
                        {/* Savings Banner */}
                        <div className="bg-gradient-to-r from-emerald-500 to-teal-500 rounded-xl p-6 text-white shadow-md flex flex-col justify-center">
                            <p className="opacity-90 text-xs font-bold uppercase tracking-wider mb-1">Lifetime Savings</p>
                            <div className="text-3xl md:text-4xl font-extrabold">RM {totalSaved.toFixed(2)}</div>
                            <p className="text-sm font-medium mt-1 opacity-90">Total amount saved from vouchers</p>
                        </div>
                    </div>
                    
                    {/* Redeem Cards */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
                        <div className="bg-white border border-gray-200 rounded-xl p-5 text-center flex flex-col justify-between shadow-sm">
                            <div>
                                <div className="font-extrabold text-lg mb-1 text-gray-900">RM1 Off</div>
                                <div className="text-sm text-gray-600 mb-4">(Redeem 200 pts)</div>
                            </div>
                            <button 
                                onClick={() => handleRedeemClick(200)}
                                disabled={balance < 200 || redeeming}
                                className="w-full bg-[#6a35d8] hover:bg-[#5b2ab9] text-white font-semibold py-2 rounded-lg transition disabled:opacity-50"
                            >
                                Redeem
                            </button>
                        </div>
                        <div className="bg-white border border-gray-200 rounded-xl p-5 text-center flex flex-col justify-between shadow-sm">
                            <div>
                                <div className="font-extrabold text-lg mb-1 text-gray-900">RM5 Off</div>
                                <div className="text-sm text-gray-600 mb-4">(Redeem 1,000 pts)</div>
                            </div>
                            <button 
                                onClick={() => handleRedeemClick(1000)}
                                disabled={balance < 1000 || redeeming}
                                className="w-full bg-[#6a35d8] hover:bg-[#5b2ab9] text-white font-semibold py-2 rounded-lg transition disabled:opacity-50"
                            >
                                Redeem
                            </button>
                        </div>
                        <div className="bg-white border border-gray-200 rounded-xl p-5 text-center flex flex-col justify-between shadow-sm">
                            <div>
                                <div className="font-extrabold text-lg mb-1 text-gray-900">RM10 Off</div>
                                <div className="text-sm text-gray-600 mb-4">(Redeem 2,000 pts)</div>
                            </div>
                            <button 
                                onClick={() => handleRedeemClick(2000)}
                                disabled={balance < 2000 || redeeming}
                                className="w-full bg-[#6a35d8] hover:bg-[#5b2ab9] text-white font-semibold py-2 rounded-lg transition disabled:opacity-50"
                            >
                                Redeem
                            </button>
                        </div>
                    </div>

                    {/* My Vouchers */}
                    <h2 className="text-xl font-bold mb-4 text-gray-900">My Vouchers</h2>
                    {displayVouchers.length === 0 ? (
                        <p className="text-gray-500 mb-8">No vouchers available.</p>
                    ) : (
                        <div className="mb-8">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                                {currentVouchers.map(v => (
                                    <div key={v.id} className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm relative flex flex-col justify-between">
                                        <div className="flex justify-between items-start mb-1">
                                            <div className="font-bold text-sm text-gray-800">VOUCHER - {v.code}</div>
                                            <span className="bg-[#e4f7eb] text-[#2d9154] text-xs font-bold px-2 py-0.5 rounded-full">(Active)</span>
                                        </div>
                                        <div className="font-extrabold text-xl mb-1 text-gray-900">RM {Number(v.discount_value).toFixed(0)}</div>
                                        {v.expires_at && (
                                            <div className="text-xs text-gray-600 mb-2">Expires - {new Date(v.expires_at).toLocaleDateString()}</div>
                                        )}
                                        
                                        <button 
                                            onClick={() => handleCopy(v.code)}
                                            className="absolute bottom-4 right-4 bg-gray-100 hover:bg-gray-200 p-2 rounded-lg text-gray-600 transition"
                                            title="Copy Code"
                                        >
                                            <span className="material-symbols-outlined text-[18px] leading-none">content_copy</span>
                                        </button>
                                    </div>
                                ))}
                            </div>
                            {totalVoucherPages > 1 && (
                                <div className="flex justify-between items-center bg-gray-50 p-2 rounded-lg border border-gray-200">
                                    <button 
                                        onClick={() => setVouchersPage(p => Math.max(1, p - 1))}
                                        disabled={vouchersPage === 1}
                                        className="px-3 py-1 bg-white border border-gray-300 rounded text-sm disabled:opacity-50"
                                    >
                                        Prev
                                    </button>
                                    <span className="text-sm font-semibold">Page {vouchersPage} of {totalVoucherPages}</span>
                                    <button 
                                        onClick={() => setVouchersPage(p => Math.min(totalVoucherPages, p + 1))}
                                        disabled={vouchersPage === totalVoucherPages}
                                        className="px-3 py-1 bg-white border border-gray-300 rounded text-sm disabled:opacity-50"
                                    >
                                        Next
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Right Column: Points History Sidebar */}
                <div className="w-full lg:w-80 lg:sticky lg:top-24 self-start">
                    <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm flex flex-col max-h-[600px] lg:max-h-[calc(100vh-160px)] relative overflow-hidden">
                        <h2 className="text-lg font-bold mb-4 text-gray-900 shrink-0">Points History</h2>
                        {transactions.length === 0 ? (
                            <p className="text-gray-500 text-sm">No recent transactions.</p>
                        ) : (
                            <>
                                <div 
                                    className="overflow-y-auto flex-1 no-scrollbar pr-1 pb-4"
                                    onScroll={(e) => {
                                        const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
                                        if (scrollHeight - scrollTop <= clientHeight + 100) {
                                            if (hasMoreHistory && !historyLoading) {
                                                loadMoreHistory();
                                            }
                                        }
                                    }}
                                >
                                    <div className="relative border-l border-gray-200 ml-2 space-y-6 mb-4">
                                        {transactions.map((tx) => {
                                            const isPositive = tx.points > 0;
                                            return (
                                                <div key={tx.id} className="relative pl-6">
                                                    <div className={`absolute -left-[5px] top-[6px] w-[9px] h-[9px] rounded-full ring-4 ring-white ${isPositive ? 'bg-[#2ea65a]' : 'bg-[#e44949]'}`}></div>
                                                    <div className={`font-bold text-lg leading-none mb-1 ${isPositive ? 'text-[#2ea65a]' : 'text-[#e44949]'}`}>
                                                        {isPositive ? '+' : ''}{tx.points.toLocaleString()}
                                                    </div>
                                                    <div className="text-sm font-semibold text-gray-800 leading-snug">{tx.description || tx.transaction_type}</div>
                                                    <div className="text-xs text-gray-500 mt-1">({new Date(tx.created_at).toLocaleString('en-MY', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })})</div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                    {!hasMoreHistory && transactions.length > 0 && (
                                        <div className="py-4 text-center text-xs font-medium text-gray-400 flex items-center justify-center gap-2">
                                            <span className="w-8 h-px bg-gray-200"></span>
                                            You reached the beginning
                                            <span className="w-8 h-px bg-gray-200"></span>
                                        </div>
                                    )}
                                </div>
                                 {hasMoreHistory && (
                                    <div className="absolute bottom-0 inset-x-0 h-16 bg-gradient-to-t from-white via-white/80 to-transparent pointer-events-none flex items-end justify-center pb-2">
                                        {historyLoading && <span className="text-xs font-bold text-gray-500 bg-white/80 px-3 py-1 rounded-full shadow-sm">Loading...</span>}
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>
            </div>

            {/* Modals */}
            {confirmRedeem && (
                <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4">
                    <div className="bg-white border border-gray-200 rounded-2xl max-w-sm w-full p-6 text-center shadow-xl text-gray-900">
                        <div className="w-16 h-16 bg-[#6a35d8]/10 text-[#6a35d8] rounded-full flex items-center justify-center mx-auto mb-4">
                            <span className="material-symbols-outlined text-3xl">stars</span>
                        </div>
                        <h3 className="text-xl font-bold mb-2">Redeem Points</h3>
                        <p className="text-gray-600 mb-6 font-medium">
                            Are you sure you want to redeem {confirmRedeem} points for RM{confirmRedeem / 200}?
                        </p>
                        <div className="flex gap-3">
                            <button 
                                onClick={() => setConfirmRedeem(null)}
                                className="flex-1 py-3 font-bold rounded-xl border border-gray-300 hover:bg-gray-50 transition"
                            >
                                Cancel
                            </button>
                            <button 
                                onClick={executeRedeem}
                                disabled={redeeming}
                                className="flex-1 py-3 font-bold rounded-xl bg-[#6a35d8] text-white hover:bg-[#5b2ab9] transition disabled:opacity-50"
                            >
                                {redeeming ? 'Processing...' : 'Confirm'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {successCode && (
                <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4">
                    <div className="bg-white border border-gray-200 rounded-2xl max-w-sm w-full p-6 text-center shadow-xl text-gray-900">
                        <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4">
                            <span className="material-symbols-outlined text-3xl">check_circle</span>
                        </div>
                        <h3 className="text-xl font-bold mb-2">Success!</h3>
                        <p className="text-gray-600 mb-4 font-medium">
                            You've successfully redeemed your points. Your voucher code is:
                        </p>
                        <div className="font-mono font-bold text-2xl text-[#6a35d8] bg-[#6a35d8]/10 py-4 rounded-lg border border-[#6a35d8]/20 mb-6 tracking-wider">
                            {successCode}
                        </div>
                        <p className="text-sm text-gray-500 mb-6 font-medium">
                            We've also emailed this code to you. You can use it during checkout.
                        </p>
                        <button 
                            onClick={() => setSuccessCode(null)}
                            className="w-full py-3 font-bold rounded-xl bg-[#6a35d8] text-white hover:bg-[#5b2ab9] transition"
                        >
                            Got it!
                        </button>
                    </div>
                </div>
            )}
        </UserDashboardLayout>
    );
}
