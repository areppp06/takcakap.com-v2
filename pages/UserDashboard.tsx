import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { currentUser } from '../services/mockData';
import { api } from '../services/api';
import { Order } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { formatCurrency } from '../utils/currency';
import UserDashboardLayout from '../components/UserDashboardLayout';

const UserDashboard: React.FC = () => {
  const [recentOrders, setRecentOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { user } = useAuth();
  const activeUser = user || currentUser;

  const getStatusBadgeClass = (status: string) => {
    if (status === 'Completed') return 'bg-green-100 text-green-700';
    if (status === 'Cancelled') return 'bg-red-100 text-red-700';
    if (status === 'Preparing') return 'bg-orange-100 text-orange-700';
    if (status === 'Ready to Pickup') return 'bg-blue-100 text-blue-700';
    if (status === 'Finding Rider') return 'bg-amber-100 text-amber-700';
    if (status === 'Rider OTW') return 'bg-indigo-100 text-indigo-700';
    if (status === 'Out For Delivery' || status === 'Rider Picked Up') return 'bg-purple-100 text-purple-700';
    if (status === 'Pending Payment' || status === 'Waiting Kitchen') return 'bg-yellow-100 text-yellow-700';
    return 'bg-gray-100 text-gray-700';
  };

  const getScheduledLabel = (order: Order): string => {
    if (order.deliveryTiming !== 'SCHEDULED') return '';
    if (order.scheduledAtLabel) return order.scheduledAtLabel;
    if (!order.scheduledAtUtc) return '';
    const date = new Date(order.scheduledAtUtc);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString('en-MY', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
  };

  const loadOrders = async (showLoading = true) => {
    if (showLoading) setIsLoading(true);
      try {
        const data = await api.getMyOrdersPage({ limit: 5 });
        setRecentOrders(data.items || []);
        setLoadError(null);
      } catch (e) {
      console.error("Failed to load orders", e);
      setRecentOrders([]);
      setLoadError(e instanceof Error ? e.message : 'Failed to load orders');
    } finally {
      if (showLoading) setIsLoading(false);
    }
  };

  useEffect(() => {
    loadOrders(true);

    const interval = setInterval(() => {
      loadOrders(false);
    }, 10000);

    return () => clearInterval(interval);
  }, []);

  return (
    <UserDashboardLayout>
            {/* Profile Header */}
            <section className="bg-white dark:bg-white/5 rounded-xl p-4 sm:p-6 md:p-8 shadow-sm border border-[#e7f4e7] dark:border-white/10">
                <div className="flex flex-col md:flex-row items-center gap-6">
                   <div className="relative">
                      <div className="size-24 rounded-full bg-primary/10 flex items-center justify-center border-4 border-white dark:border-background-dark shadow-md overflow-hidden">
                         <img className="w-full h-full object-cover" src={activeUser.avatar} alt="Profile" />
                      </div>
                   </div>
                   <div className="flex-1 text-center md:text-left">
                      <h1 className="text-2xl font-bold text-[#0d1c0d] dark:text-white">{activeUser.name}</h1>
                      <p className="text-[#499c49] font-medium">{activeUser.email}</p>
                      <div className="flex flex-wrap justify-center md:justify-start gap-4 mt-3">
                         <div className="bg-background-light dark:bg-white/5 px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1.5 border border-[#e7f4e7] dark:border-white/10">
                            <span className="material-symbols-outlined text-primary text-base">shopping_bag</span>
                            {activeUser.totalOrders || recentOrders.length} Total Orders
                         </div>
                      </div>
                   </div>
                </div>
            </section>

            {/* Recent Orders */}
            <section id="orders" className="bg-white dark:bg-white/5 rounded-xl shadow-sm border border-[#e7f4e7] dark:border-white/10 overflow-hidden">
               <div className="px-4 sm:px-6 py-4 sm:py-5 border-b border-[#e7f4e7] dark:border-white/10 flex justify-between items-center gap-3">
                  <h2 className="text-lg font-bold">Recent Orders</h2>
                  <Link to="/orders" className="text-sm font-bold text-primary hover:text-primary/80">View All</Link>
               </div>
               <div className="md:hidden p-4 space-y-3">
                  {isLoading ? (
                    <div className="text-center text-sm text-gray-500 py-4">Loading orders...</div>
                  ) : loadError ? (
                    <div className="text-center text-sm text-rose-600 py-4 space-y-2">
                      <p>Could not load orders: {loadError}</p>
                      <button type="button" onClick={() => loadOrders(true)} className="text-primary font-bold">Retry</button>
                    </div>
                  ) : recentOrders.length === 0 ? (
                    <div className="text-center text-sm text-gray-500 py-4">No orders yet.</div>
                  ) : (
                    recentOrders.map((order) => {
                      const scheduledLabel = getScheduledLabel(order);
                      return (
                        <div key={order.id} className="rounded-xl border border-[#e7f4e7] dark:border-white/10 p-3 bg-background-light dark:bg-white/5 space-y-2">
                          <div className="flex items-center justify-between gap-3">
                            <p className="font-bold text-sm">#{order.shortCode || order.id}</p>
                            <div className="flex items-center gap-1.5">
                              <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase ${getStatusBadgeClass(order.status)}`}>
                                {order.status}
                              </span>
                              {order.deliveryTiming === 'SCHEDULED' && (
                                <span className="px-2 py-1 rounded-full text-[10px] font-bold uppercase bg-fuchsia-100 text-fuchsia-700">
                                  Scheduled
                                </span>
                              )}
                            </div>
                          </div>
                          <p className="text-xs text-gray-500">{order.date}</p>
                          {scheduledLabel && (
                            <p className="text-xs text-fuchsia-700 font-semibold">Scheduled: {scheduledLabel}</p>
                          )}
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-bold">{formatCurrency(order.total)}</p>
                            {order.deliveryProvider === 'Lalamove' && order.trackingUrl ? (
                              <a
                                href={order.trackingUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-bold bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                              >
                                <span className="material-symbols-outlined text-sm">local_shipping</span>
                                Track
                              </a>
                            ) : (
                              <span className="text-xs text-gray-400">No tracking</span>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
               </div>
               <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-left min-w-[760px]">
                     <thead className="bg-background-light dark:bg-white/5 text-xs font-bold uppercase tracking-wider text-[#499c49]">
                        <tr>
                           <th className="px-6 py-4">Order #</th>
                           <th className="px-6 py-4">Date</th>
                           <th className="px-6 py-4">Status</th>
                           <th className="px-6 py-4 text-right">Value</th>
                           <th className="px-6 py-4 text-right">Track</th>
                        </tr>
                     </thead>
                     <tbody className="divide-y divide-[#e7f4e7] dark:divide-white/10">
                        {isLoading ? (
                            <tr><td colSpan={5} className="p-6 text-center text-gray-500">Loading orders...</td></tr>
                        ) : loadError ? (
                            <tr><td colSpan={5} className="p-6 text-center text-rose-600 text-sm">Could not load orders: {loadError}</td></tr>
                        ) : recentOrders.length === 0 ? (
                            <tr><td colSpan={5} className="p-6 text-center text-gray-500">No orders yet.</td></tr>
                        ) : (
                            recentOrders.map(order => {
                               const scheduledLabel = getScheduledLabel(order);
                               return (
                                 <tr key={order.id} className="hover:bg-[#f8fcf8] dark:hover:bg-white/5 transition-colors">
                                    <td className="px-6 py-4 font-semibold">{order.shortCode || order.id}</td>
                                    <td className="px-6 py-4 text-sm">
                                      <div className="flex flex-col gap-1">
                                        <span>{order.date}</span>
                                        {scheduledLabel && (
                                          <span className="text-[11px] font-semibold text-fuchsia-700">Scheduled: {scheduledLabel}</span>
                                        )}
                                      </div>
                                    </td>
                                    <td className="px-6 py-4">
                                       <div className="flex items-center gap-1.5">
                                         <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase ${getStatusBadgeClass(order.status)}`}>
                                            {order.status}
                                         </span>
                                         {order.deliveryTiming === 'SCHEDULED' && (
                                           <span className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase bg-fuchsia-100 text-fuchsia-700">
                                             Scheduled
                                           </span>
                                         )}
                                       </div>
                                    </td>
                                    <td className="px-6 py-4 text-sm font-bold text-right">{formatCurrency(order.total)}</td>
                                    <td className="px-6 py-4 text-right">
                                       {order.deliveryProvider === 'Lalamove' && order.trackingUrl ? (
                                          <a
                                            href={order.trackingUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-bold bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                                          >
                                            <span className="material-symbols-outlined text-sm">local_shipping</span>
                                            Track
                                          </a>
                                       ) : (
                                          <span className="text-xs text-gray-400">-</span>
                                       )}
                                    </td>
                                 </tr>
                               );
                            })
                        )}
                     </tbody>
                  </table>
               </div>
            </section>
    </UserDashboardLayout>
  );
};

export default UserDashboard;
