import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { currentUser } from '../services/mockData';
import { api } from '../services/api';
import { Order, ReorderPreview } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { formatCurrency } from '../utils/currency';
import AppHeader, { HeaderAvatarLink, HeaderCartLink } from '../components/AppHeader';
import UserMobileTabBar from '../components/UserMobileTabBar';
import { useCart } from '../contexts/CartContext';

const USER_ORDERS_PAGE_SIZE = 20;

const mergeOrdersUnique = (current: Order[], incoming: Order[]): Order[] => {
  const seen = new Set<string>();
  const merged: Order[] = [];
  for (const order of [...current, ...incoming]) {
    if (seen.has(order.id)) continue;
    seen.add(order.id);
    merged.push(order);
  }
  return merged;
};

const OrderHistory: React.FC = () => {
  const navigate = useNavigate();
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isDownloadingReceiptId, setIsDownloadingReceiptId] = useState<string | null>(null);
  const [isFetchingReorderId, setIsFetchingReorderId] = useState<string | null>(null);
  const [isApplyingReorder, setIsApplyingReorder] = useState(false);
  const [reorderPreview, setReorderPreview] = useState<ReorderPreview | null>(null);
  const [reorderOrderId, setReorderOrderId] = useState<string | null>(null);
  const [reorderCartMode, setReorderCartMode] = useState<'replace' | 'merge'>('replace');
  const [serviceFee, setServiceFee] = useState(1.8);
  const [notice, setNotice] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const { user, logout, isAuthenticated } = useAuth();
  const { cartCount } = useCart();
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

  const loadOrders = async (options: { append?: boolean; cursor?: string | null; showLoading?: boolean } = {}) => {
    const { append = false, cursor = null, showLoading = true } = options;
    if (append) {
      setIsLoadingMore(true);
    } else if (showLoading) {
      setIsLoading(true);
    }
    try {
      const data = await api.getMyOrdersPage({
        limit: USER_ORDERS_PAGE_SIZE,
        cursor: append ? cursor || undefined : undefined
      });
      setOrders((prev) => (append ? mergeOrdersUnique(prev, data.items || []) : data.items || []));
      setHasMore(Boolean(data.hasMore));
      setNextCursor(data.nextCursor || null);
    } catch (e) {
      console.error("Failed to load orders", e);
    } finally {
      if (append) {
        setIsLoadingMore(false);
      } else if (showLoading) {
        setIsLoading(false);
      }
    }
  };

  useEffect(() => {
    loadOrders({ showLoading: true });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadPaymentOptions = async () => {
      try {
        const options = await api.getPaymentOptions();
        if (!cancelled && options?.serviceFee !== undefined) {
          setServiceFee(Math.max(0, Number(options.serviceFee || 0)));
        }
      } catch (error) {
        console.error('Failed to load payment options for order history', error);
      }
    };
    loadPaymentOptions();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timeoutId = window.setTimeout(() => setNotice(null), 2600);
    return () => window.clearTimeout(timeoutId);
  }, [notice]);

  const handleDownloadReceipt = async (orderId: string) => {
    try {
      setIsDownloadingReceiptId(orderId);
      const fileBlob = await api.downloadOrderReceipt(orderId);
      const fileUrl = window.URL.createObjectURL(fileBlob);
      const anchor = document.createElement('a');
      anchor.href = fileUrl;
      anchor.download = `receipt-${orderId}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(fileUrl);
      setNotice({ message: `Receipt #${orderId} downloaded`, type: 'success' });
    } catch (error: any) {
      setNotice({ message: error?.message || 'Failed to download receipt', type: 'error' });
    } finally {
      setIsDownloadingReceiptId(null);
    }
  };

  const openReorderModal = async (orderId: string) => {
    try {
      setIsFetchingReorderId(orderId);
      const preview = await api.getReorderPreview(orderId);
      setReorderPreview(preview);
      setReorderOrderId(orderId);
      setReorderCartMode(preview.hasCurrentCart ? 'replace' : 'replace');
    } catch (error: any) {
      setNotice({ message: error?.message || 'Failed to prepare reorder', type: 'error' });
    } finally {
      setIsFetchingReorderId(null);
    }
  };

  const closeReorderModal = () => {
    if (isApplyingReorder) return;
    setReorderPreview(null);
    setReorderOrderId(null);
    setReorderCartMode('replace');
  };

  const handleApplyReorder = async () => {
    if (!reorderOrderId) return;
    try {
      setIsApplyingReorder(true);
      const result = await api.applyReorder(reorderOrderId, reorderCartMode);
      const message =
        result.preview.unavailableItems.length > 0 || result.preview.adjustedItems.length > 0
          ? `Added ${result.addedCount} item(s). Some items were adjusted/removed due to availability.`
          : `Added ${result.addedCount} item(s) to your cart.`;
      setNotice({ message, type: 'success' });
      closeReorderModal();
      navigate('/checkout');
    } catch (error: any) {
      setNotice({ message: error?.message || 'Failed to reorder items', type: 'error' });
    } finally {
      setIsApplyingReorder(false);
    }
  };

  const loadMoreOrders = async () => {
    if (!hasMore || !nextCursor || isLoadingMore) return;
    await loadOrders({
      append: true,
      cursor: nextCursor,
      showLoading: false
    });
  };

  return (
    <div className="min-h-screen bg-background-light dark:bg-background-dark text-[#0d1c0d] dark:text-white">
      <AppHeader
        containerClassName="px-4 md:px-10"
        maxWidthClassName="max-w-[1440px]"
        rightContent={
          <>
            <HeaderCartLink cartCount={cartCount} />
            <HeaderAvatarLink isAuthenticated={isAuthenticated} avatarUrl={activeUser.avatar} />
          </>
        }
      />

      <div className="flex flex-1 max-w-[1440px] mx-auto w-full px-4 md:px-10 pt-28 sm:pt-32 pb-24 lg:pb-8 gap-6 md:gap-8">
        {/* Sidebar */}
        <aside className="hidden lg:flex flex-col w-64 shrink-0 gap-6">
           <div className="bg-white dark:bg-white/5 rounded-xl p-6 shadow-sm border border-[#e7f4e7] dark:border-white/10 sticky top-24">
             <div className="flex flex-col gap-4">
               <Link to="/dashboard" className="flex items-center gap-3 p-2 rounded-lg hover:bg-[#e7f4e7] dark:hover:bg-white/5 transition-colors">
                 <span className="material-symbols-outlined">grid_view</span>
                 <span className="text-sm font-medium">Dashboard</span>
               </Link>
               <Link to="/orders" className="flex items-center gap-3 p-2 rounded-lg bg-primary text-[#0d1c0d] font-bold">
                 <span className="material-symbols-outlined">receipt_long</span>
                 <span className="text-sm">Order History</span>
               </Link>
               <Link to="/addresses" className="flex items-center gap-3 p-2 rounded-lg hover:bg-[#e7f4e7] dark:hover:bg-white/5 transition-colors">
                 <span className="material-symbols-outlined">location_on</span>
                 <span className="text-sm font-medium">Saved Addresses</span>
               </Link>
               <Link to="/account" className="flex items-center gap-3 p-2 rounded-lg hover:bg-[#e7f4e7] dark:hover:bg-white/5 transition-colors">
                 <span className="material-symbols-outlined">person</span>
                 <span className="text-sm font-medium">Manage Account</span>
               </Link>
             </div>
             <div className="mt-8 pt-8 border-t border-[#e7f4e7] dark:border-white/10">
                <button onClick={logout} className="flex items-center gap-3 p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg w-full transition-colors">
                   <span className="material-symbols-outlined">logout</span>
                   <span className="text-sm font-medium">Log Out</span>
                </button>
             </div>
           </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 flex flex-col gap-5 sm:gap-6 min-w-0">
            {notice && (
              <div
                className={`rounded-xl border px-4 py-3 text-sm font-semibold ${
                  notice.type === 'success'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                    : 'border-rose-200 bg-rose-50 text-rose-800'
                }`}
                role="status"
                aria-live="polite"
              >
                {notice.message}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2">
                <h1 className="text-xl sm:text-2xl font-bold">Order History</h1>
                <span className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">Showing {orders.length} orders</span>
            </div>

            <div className="space-y-6">
                {isLoading ? (
                    <div className="text-center py-12 text-gray-500">Loading your order history...</div>
                ) : orders.length === 0 ? (
                    <div className="bg-white dark:bg-white/5 rounded-xl border border-[#e7f4e7] dark:border-white/10 p-8 text-center text-gray-500">
                      No order history yet.
                    </div>
                ) : orders.map((order) => {
                    const serviceFeeAmount = Math.max(0, Number(serviceFee || 0));
                    const deliveryFee = order.orderType === 'Delivery' ? (order.deliveryFee || 0) : 0;
                    const subtotal = Math.max(order.total - serviceFeeAmount - deliveryFee, 0);
                    const isLalamoveTrackable = order.deliveryProvider === 'Lalamove' && Boolean(order.trackingUrl);
                    const paymentMethodLabel = order.paymentMethod || 'DuitNow';
                    const paymentMethodIcon = paymentMethodLabel.toLowerCase() === 'duitnow' ? 'qr_code_2' : 'payments';
                    const scheduledLabel = getScheduledLabel(order);

                    return (
                    <div key={order.id} className="bg-white dark:bg-white/5 rounded-xl border border-[#e7f4e7] dark:border-white/10 shadow-sm overflow-hidden">
                        {/* Order Header */}
                        <div className="p-4 sm:p-6 bg-gray-50/50 dark:bg-white/5 border-b border-[#e7f4e7] dark:border-white/10 flex flex-col md:flex-row md:items-center justify-between gap-3 sm:gap-4">
                            <div className="flex flex-col gap-1">
                                <div className="flex items-center gap-3">
                                    <h3 className="font-bold text-lg">{order.id}</h3>
                                    <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${getStatusBadgeClass(order.status)}`}>
                                        {order.status}
                                    </span>
                                    {order.deliveryTiming === 'SCHEDULED' && (
                                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-fuchsia-100 text-fuchsia-700">
                                        Scheduled
                                      </span>
                                    )}
                                </div>
                                <p className="text-sm text-gray-500">{order.date}</p>
                            </div>
                            <div className="flex flex-col md:items-end gap-1">
                                <span className="text-xs text-gray-500 uppercase font-bold tracking-wider">Total Amount</span>
                                <span className="text-xl font-extrabold text-primary">{formatCurrency(order.total)}</span>
                            </div>
                        </div>

                        {/* Order Details */}
                        <div className="p-4 sm:p-6 grid grid-cols-1 md:grid-cols-2 gap-5 sm:gap-8">
                             <div>
                                 <h4 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3">Order Summary</h4>
                                 <p className="text-sm font-medium leading-relaxed">{order.itemsSummary}</p>
                                 <div className="mt-4 flex flex-col gap-1">
                                     <div className="flex justify-between text-xs">
                                         <span className="text-gray-500">Subtotal</span>
                                         <span>{formatCurrency(subtotal)}</span>
                                     </div>
                                     <div className="flex justify-between text-xs">
                                         <span className="text-gray-500">Service Fee</span>
                                         <span>{formatCurrency(serviceFeeAmount)}</span>
                                     </div>
                                     {order.orderType === 'Delivery' && (
                                         <div className="flex justify-between text-xs">
                                             <span className="text-gray-500">Delivery Fee</span>
                                             <span>{formatCurrency(deliveryFee)}</span>
                                         </div>
                                     )}
                                 </div>
                             </div>
                             
                             <div className="space-y-4">
                                 <div>
                                    <h4 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-2">Delivery Details</h4>
                                    <div className="flex items-start gap-2">
                                        <span className="material-symbols-outlined text-gray-400 text-lg mt-0.5">location_on</span>
                                        <p className="text-sm">{order.address || 'Self Pickup'}</p>
                                    </div>
                                    {scheduledLabel && (
                                      <div className="mt-2 flex items-start gap-2">
                                        <span className="material-symbols-outlined text-gray-400 text-lg mt-0.5">schedule</span>
                                        <p className="text-sm">Scheduled for {scheduledLabel}</p>
                                      </div>
                                    )}
                                 </div>
                                 <div>
                                    <h4 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-2">Payment Method</h4>
                                    <div className="flex items-center gap-2">
                                        <span className="material-symbols-outlined text-gray-400 text-lg">{paymentMethodIcon}</span>
                                        <p className="text-sm">{paymentMethodLabel}</p>
                                    </div>
                                 </div>
                             </div>
                        </div>
                        
                        {/* Footer Actions */}
                        <div className="px-4 sm:px-6 py-4 bg-gray-50/50 dark:bg-white/5 border-t border-[#e7f4e7] dark:border-white/10 flex flex-col sm:flex-row sm:justify-end gap-2 sm:gap-3">
                            {isLalamoveTrackable && (
                                <a
                                    href={order.trackingUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="w-full sm:w-auto px-4 py-2 bg-primary/10 text-primary rounded-lg text-sm font-bold hover:bg-primary/20 transition-colors flex items-center justify-center gap-2"
                                >
                                    <span className="material-symbols-outlined text-base">local_shipping</span>
                                    Track on Lalamove
                                </a>
                            )}
                            <button
                                onClick={() => handleDownloadReceipt(order.id)}
                                disabled={isDownloadingReceiptId === order.id}
                                className="w-full sm:w-auto px-4 py-2 bg-white dark:bg-transparent border border-gray-200 dark:border-gray-700 rounded-lg text-sm font-semibold hover:bg-gray-50 dark:hover:bg-white/10 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                                {isDownloadingReceiptId === order.id ? 'Downloading...' : 'Download Receipt'}
                            </button>
                            <button
                                onClick={() => openReorderModal(order.id)}
                                disabled={isFetchingReorderId === order.id}
                                className="w-full sm:w-auto px-4 py-2 bg-primary text-background-dark rounded-lg text-sm font-bold hover:bg-primary/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                                {isFetchingReorderId === order.id ? 'Checking...' : 'Re-Order'}
                            </button>
                        </div>
                    </div>
                )})}

                {!isLoading && isLoadingMore && (
                  <div className="text-center py-4 text-xs font-semibold text-gray-500">Loading more orders...</div>
                )}

                {!isLoading && orders.length > 0 && hasMore && (
                  <div className="flex justify-center">
                    <button
                      onClick={loadMoreOrders}
                      disabled={isLoadingMore}
                      className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors ${
                        isLoadingMore
                          ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                          : 'bg-primary text-background-dark hover:bg-primary/90'
                      }`}
                    >
                      {isLoadingMore ? 'Loading...' : 'Load More Orders'}
                    </button>
                  </div>
                )}
            </div>
        </main>
      </div>

      {reorderPreview && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-[1px]" onClick={closeReorderModal} />
          <div className="relative w-full max-w-2xl max-h-[88vh] overflow-y-auto rounded-2xl border border-primary/20 bg-white dark:bg-zinc-900 p-4 sm:p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg sm:text-xl font-extrabold">Reorder Summary</h3>
                <p className="text-xs sm:text-sm text-gray-500 mt-1">
                  Order #{reorderPreview.orderId} • {reorderPreview.addableCount} item(s) can be added
                </p>
              </div>
              <button
                onClick={closeReorderModal}
                className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
                aria-label="Close"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            {reorderPreview.hasCurrentCart && (
              <div className="mt-4 rounded-xl border border-primary/20 bg-primary/5 p-3 space-y-2">
                <p className="text-xs sm:text-sm font-semibold">Your cart already has items. Choose how to apply reorder:</p>
                <div className="flex flex-col sm:flex-row gap-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="reorder-cart-mode"
                      checked={reorderCartMode === 'replace'}
                      onChange={() => setReorderCartMode('replace')}
                    />
                    Replace current cart (Recommended)
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="reorder-cart-mode"
                      checked={reorderCartMode === 'merge'}
                      onChange={() => setReorderCartMode('merge')}
                    />
                    Merge with current cart
                  </label>
                </div>
              </div>
            )}

            <div className="mt-4 space-y-3">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                <p className="text-sm font-bold text-emerald-800">Available ({reorderPreview.availableItems.length})</p>
                <div className="mt-2 space-y-1.5">
                  {reorderPreview.availableItems.length === 0 ? (
                    <p className="text-xs text-emerald-700">No fully available items</p>
                  ) : (
                    reorderPreview.availableItems.map((item) => (
                      <p key={`available-${item.menuItemId}`} className="text-xs sm:text-sm text-emerald-800">
                        {item.quantity}x {item.name}
                      </p>
                    ))
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                <p className="text-sm font-bold text-amber-800">Adjusted ({reorderPreview.adjustedItems.length})</p>
                <div className="mt-2 space-y-1.5">
                  {reorderPreview.adjustedItems.length === 0 ? (
                    <p className="text-xs text-amber-700">No adjusted items</p>
                  ) : (
                    reorderPreview.adjustedItems.map((item) => (
                      <p key={`adjusted-${item.menuItemId}`} className="text-xs sm:text-sm text-amber-800">
                        {item.requestedQuantity}x → {item.quantity}x {item.name} ({item.reason})
                      </p>
                    ))
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-rose-200 bg-rose-50 p-3">
                <p className="text-sm font-bold text-rose-800">Unavailable ({reorderPreview.unavailableItems.length})</p>
                <div className="mt-2 space-y-1.5">
                  {reorderPreview.unavailableItems.length === 0 ? (
                    <p className="text-xs text-rose-700">No unavailable items</p>
                  ) : (
                    reorderPreview.unavailableItems.map((item) => (
                      <p key={`unavailable-${item.menuItemId}`} className="text-xs sm:text-sm text-rose-800">
                        {item.requestedQuantity}x {item.name} ({item.reason})
                      </p>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="mt-5 flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
              <button
                onClick={closeReorderModal}
                className="w-full sm:w-auto px-4 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 text-sm font-semibold hover:bg-gray-50 dark:hover:bg-white/10 transition-colors"
                disabled={isApplyingReorder}
              >
                Cancel
              </button>
              <button
                onClick={handleApplyReorder}
                disabled={isApplyingReorder || reorderPreview.addableCount <= 0}
                className="w-full sm:w-auto px-4 py-2.5 rounded-lg bg-primary text-background-dark text-sm font-bold hover:bg-primary/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isApplyingReorder ? 'Adding...' : 'Add Available Items'}
              </button>
            </div>
          </div>
        </div>
      )}
      <UserMobileTabBar />
    </div>
  );
};

export default OrderHistory;
