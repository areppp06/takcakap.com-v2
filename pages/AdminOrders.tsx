import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { Order } from '../types';
import { formatCurrency } from '../utils/currency';
import { useAuth } from '../contexts/AuthContext';
import BrandLogo from '../components/BrandLogo';
import AdminMobileNav from '../components/AdminMobileNav';
import AdminSidebarNav from '../components/AdminSidebarNav';
import AdminSidebarFooter from '../components/AdminSidebarFooter';

type ConfirmDialogState = {
  title: string;
  message: string;
  confirmLabel: string;
  confirmVariant?: 'primary' | 'danger';
  onConfirm: () => void;
} | null;

type RealtimeState = 'connecting' | 'live' | 'reconnecting' | 'offline';
type LoadOrdersOptions = {
  append?: boolean;
  cursor?: string | null;
  showLoading?: boolean;
};

const ADMIN_ORDERS_PAGE_SIZE = 40;
const SEARCH_DEBOUNCE_MS = 350;

const resolveServerFilters = (
  filter: string
): {
  status?: string;
  refundStatus?: 'pending' | 'processed' | 'failed';
  deliveryTiming?: 'NOW' | 'SCHEDULED';
} => {
  if (filter === 'All') return {};
  if (filter === 'Scheduled') return { deliveryTiming: 'SCHEDULED' };
  if (filter === 'Refund Pending') return { refundStatus: 'pending' };
  if (filter === 'Refunded') return { refundStatus: 'processed' };
  if (filter === 'Refund Failed') return { refundStatus: 'failed' };
  return { status: filter };
};

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

const AdminOrders: React.FC = () => {
  const REFUND_FALLBACK_WINDOW_MS = 48 * 60 * 60 * 1000;
  const PICKUP_COMPLETED_REFUND_FALLBACK_WINDOW_MS = 24 * 60 * 60 * 1000;
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [realtimeState, setRealtimeState] = useState<RealtimeState>('connecting');
  const [filter, setFilter] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState>(null);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [cancelingOrderId, setCancelingOrderId] = useState<string | null>(null);
  const [refundingOrderId, setRefundingOrderId] = useState<string | null>(null);
  const [clockNowMs, setClockNowMs] = useState(Date.now());
  const location = useLocation();
  const navigate = useNavigate();
  const { logout } = useAuth();

  const requestVersionRef = useRef(0);
  const sseReconnectTimerRef = useRef<number | null>(null);

  useEffect(() => {
      const timeoutId = window.setTimeout(() => {
          setDebouncedSearchQuery(searchQuery.trim());
      }, SEARCH_DEBOUNCE_MS);
      return () => window.clearTimeout(timeoutId);
  }, [searchQuery]);

  const loadData = useCallback(
      async (options: LoadOrdersOptions = {}) => {
          const {
              append = false,
              cursor = null,
              showLoading = true
          } = options;
          const requestVersion = ++requestVersionRef.current;
          if (append) {
              setIsLoadingMore(true);
          } else if (showLoading) {
              setIsLoading(true);
          } else {
              setIsSyncing(true);
          }

          try {
              const filters = resolveServerFilters(filter);
              const response = await api.getAdminOrders({
                  limit: ADMIN_ORDERS_PAGE_SIZE,
                  cursor: append ? cursor || undefined : undefined,
                  status: filters.status,
                  refundStatus: filters.refundStatus,
                  deliveryTiming: filters.deliveryTiming,
                  q: debouncedSearchQuery || undefined
              });
              if (requestVersion !== requestVersionRef.current) return;

              setOrders((prev) =>
                  append ? mergeOrdersUnique(prev, response.items || []) : response.items || []
              );
              setHasMore(Boolean(response.hasMore));
              setNextCursor(response.nextCursor || null);
          } catch (e) {
              console.error('Failed to load orders', e);
              if (!append) {
                  setNotice({ type: 'error', message: 'Failed to load orders. Please try again.' });
              }
          } finally {
              if (append) {
                  setIsLoadingMore(false);
              } else if (showLoading) {
                  setIsLoading(false);
              } else {
                  setIsSyncing(false);
              }
          }
      },
      [filter, debouncedSearchQuery]
  );

  const refreshOrders = useCallback(async () => {
      await loadData({ showLoading: false });
  }, [loadData]);

  useEffect(() => {
      loadData({ showLoading: true });
  }, [loadData]);

  useEffect(() => {
      let disposed = false;
      let streamAbortController: AbortController | null = null;

      const closeCurrentSource = () => {
          if (streamAbortController) {
              streamAbortController.abort();
              streamAbortController = null;
          }
      };

      const scheduleReconnect = (delayMs = 5000) => {
          if (disposed) return;
          if (sseReconnectTimerRef.current) {
              window.clearTimeout(sseReconnectTimerRef.current);
          }
          sseReconnectTimerRef.current = window.setTimeout(() => {
              void connect();
          }, delayMs);
      };

      const connect = async () => {
          if (disposed) return;
          setRealtimeState((prev) => (prev === 'live' ? 'reconnecting' : 'connecting'));
          let streamToken = '';
          try {
              const streamSession = await api.getAdminOrdersStreamToken();
              if (disposed) return;
              streamToken = String(streamSession.token || '').trim();
              if (!streamToken) {
                  throw new Error('Missing stream token');
              }
          } catch (error) {
              if (disposed) return;
              console.error('Failed to fetch admin stream token', error);
              setRealtimeState('offline');
              scheduleReconnect(5000);
              return;
          }

          closeCurrentSource();
          const controller = new AbortController();
          streamAbortController = controller;
          let sawSessionExpired = false;

          try {
              await api.streamAdminOrdersEvents({
                  streamToken,
                  signal: controller.signal,
                  onEvent: (eventName) => {
                      if (disposed) return;
                      if (eventName === 'connected' || eventName === 'ping') {
                          setRealtimeState('live');
                          return;
                      }
                      if (eventName === 'orders_changed') {
                          setRealtimeState('live');
                          refreshOrders().catch(() => null);
                          return;
                      }
                      if (eventName === 'session_expired') {
                          sawSessionExpired = true;
                          setRealtimeState('reconnecting');
                      }
                  }
              });
          } catch (error) {
              if (disposed || controller.signal.aborted) return;
              console.error('Admin orders stream closed with error', error);
          }

          if (disposed || controller.signal.aborted) return;
          setRealtimeState('reconnecting');
          scheduleReconnect(sawSessionExpired ? 500 : 5000);
      };

      void connect();

      return () => {
          disposed = true;
          if (sseReconnectTimerRef.current) {
              window.clearTimeout(sseReconnectTimerRef.current);
              sseReconnectTimerRef.current = null;
          }
          closeCurrentSource();
      };
  }, [refreshOrders]);

  useEffect(() => {
      const interval = window.setInterval(() => setClockNowMs(Date.now()), 1000);
      return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
      if (!notice) return;
      const timeoutId = window.setTimeout(() => setNotice(null), 3200);
      return () => window.clearTimeout(timeoutId);
  }, [notice]);

  const updateStatus = async (id: string, newStatus: string) => {
      // Optimistic update
      setOrders(prev => prev.map(o => o.id === id ? { ...o, status: newStatus as any } : o));
      try {
          const response = await api.updateOrderStatus(id, newStatus);
          if (newStatus === 'Cancelled') {
              if (response.refund) {
                  setNotice({
                      type: 'success',
                      message: `Order #${id} cancelled. Refund ${response.refund.status}.`
                  });
              } else if (response.autoRefundAttempted && response.autoRefundError) {
                  setNotice({
                      type: 'error',
                      message: `Order #${id} cancelled, but refund failed: ${response.autoRefundError}`
                  });
              } else {
                  setNotice({ type: 'success', message: `Order #${id} cancelled successfully.` });
              }
              await refreshOrders();
          }
      } catch (e) {
          console.error("Failed to update status", e);
          void refreshOrders(); // Revert on fail silently
      }
  };

  const getStatusColor = (status: string) => {
      switch(status) {
          case 'Pending Payment': return 'bg-gray-100 text-gray-500 border-gray-200';
          case 'Preparing': return 'bg-orange-100 text-orange-800 border-orange-200';
          case 'Finding Rider': return 'bg-amber-100 text-amber-800 border-amber-200';
          case 'Rider OTW': return 'bg-indigo-100 text-indigo-800 border-indigo-200';
          case 'Out For Delivery': return 'bg-purple-100 text-purple-800 border-purple-200';
          case 'Ready to Pickup': return 'bg-blue-100 text-blue-800 border-blue-200';
          case 'Rider Picked Up': return 'bg-purple-100 text-purple-800 border-purple-200';
          case 'Waiting Kitchen': return 'bg-yellow-100 text-yellow-800 border-yellow-200 animate-pulse';
          case 'Completed': return 'bg-green-100 text-green-800 border-green-200';
          case 'Cancelled': return 'bg-red-50 text-red-800 border-red-100 opacity-70';
          default: return 'bg-gray-100 text-gray-800';
      }
  };
  const getScheduledLabel = (order: Order) => {
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
  const getRefundFilterLabel = (order: Order) => {
      if (order.refundStatus === 'pending') return 'Refund Pending';
      if (order.refundStatus === 'processed') return 'Refunded';
      if (order.refundStatus === 'failed') return 'Refund Failed';
      return '';
  };

  const getRefundBadgeStyle = (status?: Order['refundStatus']) => {
      if (status === 'pending') return 'bg-amber-100 text-amber-800 border-amber-200';
      if (status === 'processed') return 'bg-emerald-100 text-emerald-800 border-emerald-200';
      if (status === 'failed') return 'bg-rose-100 text-rose-800 border-rose-200';
      return 'bg-gray-100 text-gray-700 border-gray-200';
  };

  const filteredOrders = useMemo(() => orders, [orders]);
  const statusFilters = [
      'All',
      'Scheduled',
      'Preparing',
      'Ready to Pickup',
      'Finding Rider',
      'Rider OTW',
      'Out For Delivery',
      'Refund Pending',
      'Refunded',
      'Refund Failed',
      'Completed',
      'Cancelled'
  ];

  const loadMoreOrders = async () => {
      if (!hasMore || !nextCursor || isLoadingMore) return;
      await loadData({
          append: true,
          cursor: nextCursor,
          showLoading: false
      });
  };

  const askConfirmation = (config: NonNullable<ConfirmDialogState>) => {
      setConfirmDialog(config);
  };

  const closeConfirmation = () => {
      setConfirmDialog(null);
  };

  const confirmAction = () => {
      if (!confirmDialog) return;
      const run = confirmDialog.onConfirm;
      setConfirmDialog(null);
      run();
  };
  const handleLogout = () => {
      logout();
      navigate('/admin/login', { replace: true });
  };

  const getOrderTime = (dateValue: string) => {
      const parts = String(dateValue || '').split(',');
      return (parts[1] || parts[0] || '').trim();
  };

  const getLalamoveCancelRemainingSeconds = (order: Order): number | null => {
      if (order.cancelWindowMode !== 'LIMITED') return order.cancelWindowRemainingSeconds ?? null;
      if (order.cancelWindowEndsAtUtc) {
          const endsAtMs = new Date(order.cancelWindowEndsAtUtc).getTime();
          if (!Number.isNaN(endsAtMs)) {
              return Math.max(0, Math.floor((endsAtMs - clockNowMs) / 1000));
          }
      }
      return order.cancelWindowRemainingSeconds ?? null;
  };

  const formatCountdown = (seconds: number) => {
      const safeSeconds = Math.max(0, seconds);
      const mins = Math.floor(safeSeconds / 60);
      const secs = safeSeconds % 60;
      return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  const getCanCancelLalamove = (order: Order) => {
      if (order.deliveryProvider !== 'Lalamove') return false;
      if (order.status === 'Completed' || order.status === 'Cancelled') return false;
      if (order.cancelWindowMode === 'OPEN_UNTIL_ASSIGNED') return true;
      if (order.cancelWindowMode === 'LIMITED') {
          const remaining = getLalamoveCancelRemainingSeconds(order);
          if (remaining === null) return Boolean(order.canCancelLalamove);
          return remaining > 0;
      }
      return false;
  };

  const getCanRequestRefund = (order: Order) => {
      const hasPendingOrProcessedRefund =
          order.refundStatus === 'pending' || order.refundStatus === 'processed';
      if (hasPendingOrProcessedRefund) return false;
      if (String(order.paymentMethod || '').toLowerCase() !== 'curlec') return false;
      if (getCanCancelLalamove(order)) return false;
      if (order.canRequestRefund !== undefined) return Boolean(order.canRequestRefund);

      // Fallback for older API payloads that do not include refund eligibility flags.
      const createdAtMs = new Date(order.createdAtUtc || order.date || '').getTime();
      if (Number.isNaN(createdAtMs)) {
          if (order.orderType === 'Pickup') {
              return order.status === 'Completed' || order.status === 'Cancelled';
          }
          if (order.deliveryProvider === 'Lalamove') return true;
          return order.status === 'Cancelled';
      }
      const elapsedMs = Date.now() - createdAtMs;

      if (order.orderType === 'Pickup') {
          if (order.status === 'Completed') {
              return elapsedMs <= PICKUP_COMPLETED_REFUND_FALLBACK_WINDOW_MS;
          }
          if (order.status === 'Cancelled') {
              return elapsedMs <= REFUND_FALLBACK_WINDOW_MS;
          }
          return false;
      }

      if (order.deliveryProvider === 'Lalamove') {
          return elapsedMs <= REFUND_FALLBACK_WINDOW_MS;
      }

      if (order.status === 'Cancelled') {
          return elapsedMs <= REFUND_FALLBACK_WINDOW_MS;
      }
      return false;
  };

  const cancelLalamoveOrder = async (order: Order) => {
      const canCancel = getCanCancelLalamove(order);
      if (!canCancel) return;
      setCancelingOrderId(order.id);
      try {
          const response = await api.cancelAdminOrder(order.id);
          if (response.refund) {
              setNotice({
                  type: 'success',
                  message: `Order #${order.id} cancelled. Refund ${response.refund.status}.`
              });
          } else if (response.autoRefundAttempted && response.autoRefundError) {
              setNotice({
                  type: 'error',
                  message: `Order #${order.id} cancelled, but refund failed: ${response.autoRefundError}`
              });
          } else {
              setNotice({ type: 'success', message: `Order #${order.id} cancelled successfully.` });
          }
          await refreshOrders();
      } catch (error: any) {
          setNotice({ type: 'error', message: error?.message || `Failed to cancel order #${order.id}` });
      } finally {
          setCancelingOrderId(null);
      }
  };

  const requestRefund = async (order: Order) => {
      if (!getCanRequestRefund(order)) return;
      setRefundingOrderId(order.id);
      try {
          const response = await api.refundAdminOrder(order.id);
          setNotice({
              type: 'success',
              message: `Refund ${response.refund.status} for order #${order.id}.`
          });
          await refreshOrders();
      } catch (error: any) {
          setNotice({
              type: 'error',
              message: error?.message || `Failed to start refund for order #${order.id}`
          });
      } finally {
          setRefundingOrderId(null);
      }
  };

  const renderOrderActions = (order: Order, compact = false) => {
      const isPickupOrder = order.orderType === 'Pickup';
      const isLalamoveOrder = order.orderType === 'Delivery' && order.deliveryProvider === 'Lalamove';
      const compactButton = compact ? 'w-full justify-center' : '';
      const canCancelLalamove = getCanCancelLalamove(order);
      const canRequestRefund = getCanRequestRefund(order);
      const cancelRemainingSeconds = getLalamoveCancelRemainingSeconds(order);
      const isCanceling = cancelingOrderId === order.id;
      const isRefunding = refundingOrderId === order.id;
      const isTerminalDeliveryStatus = order.status === 'Cancelled' || order.status === 'Completed';

      return (
          <div className={`flex items-center gap-2 ${compact ? 'flex-wrap' : 'justify-end'}`}>
              {isPickupOrder && order.status === 'Preparing' && (
                  <button
                      onClick={() => {
                          askConfirmation({
                              title: 'Confirm Status Update',
                              message: 'Mark this pickup order as Ready to Pickup? This action cannot be undone.',
                              confirmLabel: 'Yes, Mark Ready',
                              onConfirm: () => updateStatus(order.id, 'Ready to Pickup')
                          });
                      }}
                      className={`bg-blue-500 hover:bg-blue-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 transition-all shadow-md shadow-blue-500/20 ${compactButton}`}
                  >
                      <span className="material-symbols-outlined text-sm">notifications_active</span>
                      Mark Ready
                  </button>
              )}

              {isPickupOrder && order.status === 'Ready to Pickup' && (
                  <button
                      onClick={() => {
                          askConfirmation({
                              title: 'Confirm Status Update',
                              message: 'Mark this pickup order as Picked Up and Completed? This action cannot be undone.',
                              confirmLabel: 'Yes, Mark Picked Up',
                              onConfirm: () => updateStatus(order.id, 'Completed')
                          });
                      }}
                      className={`bg-green-500 hover:bg-green-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 transition-all shadow-md shadow-green-500/20 ${compactButton}`}
                  >
                      <span className="material-symbols-outlined text-sm">check_circle</span>
                      Picked Up
                  </button>
              )}

              {isPickupOrder && order.status === 'Rider Picked Up' && (
                  <button
                      onClick={() => {
                          askConfirmation({
                              title: 'Confirm Status Update',
                              message: 'Mark this order as Completed? This action cannot be undone.',
                              confirmLabel: 'Yes, Complete Order',
                              onConfirm: () => updateStatus(order.id, 'Completed')
                          });
                      }}
                      className={`bg-green-500 hover:bg-green-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 transition-all shadow-md shadow-green-500/20 ${compactButton}`}
                  >
                      <span className="material-symbols-outlined text-sm">check_circle</span>
                      Delivered
                  </button>
              )}

              {isPickupOrder && ['Preparing', 'Ready to Pickup', 'Waiting Kitchen'].includes(order.status) && (
                  <button
                      onClick={() => {
                          askConfirmation({
                              title: 'Cancel Order',
                              message: 'Cancel this order now? This action cannot be undone.',
                              confirmLabel: 'Yes, Cancel Order',
                              confirmVariant: 'danger',
                              onConfirm: () => updateStatus(order.id, 'Cancelled')
                          });
                      }}
                      className={`bg-gray-100 hover:bg-red-50 text-gray-500 hover:text-red-600 px-2 py-1.5 rounded-lg transition-colors ${compact ? 'w-full flex items-center justify-center gap-1.5 text-xs font-bold' : ''}`}
                      title="Cancel Order"
                  >
                      <span className="material-symbols-outlined text-lg">cancel</span>
                      {compact ? 'Cancel Order' : null}
                  </button>
              )}

              {isLalamoveOrder && (
                  <>
                      <div className={`flex flex-col ${compact ? 'w-full' : 'items-end'} gap-1`}>
                          {order.cancelWindowMode === 'OPEN_UNTIL_ASSIGNED' && (
                              <span className="text-[10px] font-bold uppercase text-amber-700">Cancelable until rider assigned</span>
                          )}
                          {order.cancelWindowMode === 'LIMITED' && cancelRemainingSeconds !== null && (
                              <span className="text-[10px] font-bold uppercase text-amber-700">
                                  Cancel Window: {formatCountdown(cancelRemainingSeconds)}
                              </span>
                          )}
                          {isTerminalDeliveryStatus && order.status === 'Cancelled' && (
                              <span className="text-[10px] font-bold uppercase text-emerald-700">Order cancelled</span>
                          )}
                          {!isTerminalDeliveryStatus && order.cancelWindowMode === 'CLOSED' && (
                              <span className="text-[10px] font-bold uppercase text-gray-400">Cancel window ended</span>
                          )}
                          {!isTerminalDeliveryStatus && (
                              <button
                                  onClick={() =>
                                      askConfirmation({
                                          title: 'Cancel Delivery Order',
                                          message: 'Cancel this Lalamove order now? This action cannot be undone.',
                                          confirmLabel: 'Yes, Cancel Delivery',
                                          confirmVariant: 'danger',
                                          onConfirm: () => cancelLalamoveOrder(order)
                                      })
                                  }
                                  disabled={!canCancelLalamove || isCanceling}
                                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${
                                      canCancelLalamove && !isCanceling
                                          ? 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100'
                                          : 'bg-gray-100 text-gray-400 border-gray-200 blur-[0.35px] cursor-not-allowed'
                                  } ${compact ? 'w-full' : ''}`}
                              >
                                  {isCanceling ? 'Cancelling...' : 'Cancel Delivery'}
                              </button>
                          )}
                      </div>
                      {order.trackingUrl ? (
                          <a
                              href={order.trackingUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={`bg-primary/10 hover:bg-primary/20 text-primary px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 transition-all ${compactButton}`}
                          >
                              <span className="material-symbols-outlined text-sm">local_shipping</span>
                              Track
                          </a>
                      ) : (
                          <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase border bg-slate-100 text-slate-700 border-slate-200 ${compact ? 'w-full text-center' : ''}`}>
                              Auto via Lalamove
                          </span>
                      )}
                  </>
              )}

              {(order.refundStatus === 'pending' || order.refundStatus === 'processed') && (
                  <span
                      className={`px-2 py-1 rounded text-[10px] font-bold uppercase border ${getRefundBadgeStyle(
                          order.refundStatus
                      )} ${compact ? 'w-full text-center' : ''}`}
                  >
                      {order.refundStatus === 'pending' ? 'Refund Pending' : 'Refunded'}
                  </span>
              )}

              {canRequestRefund && (
                  <button
                      onClick={() =>
                          askConfirmation({
                              title: 'Initiate Refund',
                              message: 'Start refund for this cancelled order now? This action cannot be undone.',
                              confirmLabel: 'Yes, Start Refund',
                              confirmVariant: 'danger',
                              onConfirm: () => requestRefund(order)
                          })
                      }
                      disabled={isRefunding}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${
                          isRefunding
                              ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
                              : 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                      } ${compact ? 'w-full' : ''}`}
                  >
                      {isRefunding
                          ? 'Refunding...'
                          : order.refundStatus === 'failed'
                            ? 'Retry Refund'
                            : 'Refund'}
                  </button>
              )}
          </div>
      );
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
          {notice && (
              <div
                  className={`mb-4 rounded-xl border px-4 py-3 text-sm font-semibold ${
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
          <header className="mb-6">
             <div>
                <h2 className="text-3xl font-extrabold tracking-tight">Kitchen Orders</h2>
                <p className="text-slate-500">Track, prepare, and complete customer orders.</p>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-wide">
                    <span
                        className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 ${
                            realtimeState === 'live'
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                : realtimeState === 'reconnecting' || realtimeState === 'connecting'
                                  ? 'border-amber-200 bg-amber-50 text-amber-700'
                                  : 'border-slate-200 bg-slate-100 text-slate-600'
                        }`}
                    >
                        <span className="material-symbols-outlined text-[13px]">wifi</span>
                        {realtimeState === 'live'
                            ? 'Realtime Live'
                            : realtimeState === 'reconnecting'
                              ? 'Realtime Reconnecting'
                              : realtimeState === 'connecting'
                                ? 'Realtime Connecting'
                                : 'Realtime Offline'}
                    </span>
                    {isSyncing && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1 text-slate-600">
                            <span className="material-symbols-outlined text-[13px] animate-spin">sync</span>
                            Syncing
                        </span>
                    )}
                </div>
             </div>
          </header>

          <div className="mb-6 flex flex-col gap-3">
             <div className="relative w-full max-w-md">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-lg">search</span>
                <input
                   type="text"
                   value={searchQuery}
                   onChange={(e) => setSearchQuery(e.target.value)}
                   placeholder="Search by order ID, menu name, customer name, or phone"
                   className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
             </div>
             <div className="overflow-x-auto rounded-xl border border-gray-100 bg-white p-1.5 dark:border-slate-700 dark:bg-slate-800">
               <div className="flex items-center gap-2 min-w-max">
                {statusFilters.map(f => (
                    <button 
                        key={f}
                        onClick={() => setFilter(f)} 
                        className={`shrink-0 px-4 py-2 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${filter === f ? 'bg-primary text-white shadow-md' : 'text-slate-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-700'}`}
                    >
                        {f}
                    </button>
                ))}
               </div>
             </div>
          </div>

          <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-100 dark:border-slate-700 shadow-sm overflow-hidden">
             {realtimeState === 'connecting' || isLoading ? (
                 <div className="p-16 flex flex-col items-center justify-center text-center">
                     <div className="relative mb-4">
                         <span className="absolute -inset-2 rounded-full bg-primary/20 animate-ping duration-1000" />
                         <div className="relative w-16 h-16 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shadow-inner">
                             <span className="material-symbols-outlined text-3xl animate-pulse-soft">wifi</span>
                         </div>
                     </div>
                     <h3 className="text-lg font-bold text-slate-800 dark:text-white">Connecting to Kitchen Stream...</h3>
                     <p className="text-sm text-slate-500 dark:text-zinc-400 mt-2 max-w-sm">
                         Establishing a secure real-time connection to receive new orders. Please wait.
                     </p>
                 </div>
             ) : (
                 <>
                     <div className="lg:hidden p-3 sm:p-4 space-y-3">
                         {filteredOrders.map((order) => {
                             const scheduledLabel = getScheduledLabel(order);
                             return (
                                 <article key={order.id} className="rounded-xl border border-gray-100 dark:border-slate-700 bg-white dark:bg-slate-900/30 p-4 shadow-sm">
                                     <div className="flex items-start justify-between gap-3">
                                         <div className="min-w-0">
                                             <p className="text-sm font-extrabold leading-none">#{order.id}</p>
                                             <p className="text-xs text-gray-400 mt-1">{getOrderTime(order.date)}</p>
                                             {scheduledLabel && (
                                                 <p className="text-[11px] font-semibold text-fuchsia-700 mt-1">Scheduled: {scheduledLabel}</p>
                                             )}
                                         </div>
                                         <div className="flex flex-col items-end gap-1">
                                             <span className={`inline-flex px-2 py-1 rounded text-[10px] font-bold uppercase border whitespace-nowrap ${getStatusColor(order.status)}`}>
                                                 {order.status}
                                             </span>
                                             {order.deliveryTiming === 'SCHEDULED' && (
                                                 <span className="inline-flex px-2 py-1 rounded text-[10px] font-bold uppercase border whitespace-nowrap bg-fuchsia-100 text-fuchsia-700 border-fuchsia-200">
                                                     Scheduled
                                                 </span>
                                             )}
                                             {order.refundStatus && (
                                                 <span
                                                     className={`inline-flex px-2 py-1 rounded text-[10px] font-bold uppercase border whitespace-nowrap ${getRefundBadgeStyle(
                                                         order.refundStatus
                                                     )}`}
                                                 >
                                                     {getRefundFilterLabel(order)}
                                                 </span>
                                             )}
                                         </div>
                                     </div>

                                     <div className="mt-3 flex items-center justify-between gap-3">
                                         <span className={`text-xs font-bold flex items-center gap-1 ${order.orderType === 'Delivery' ? 'text-blue-600' : 'text-purple-600'}`}>
                                             <span className="material-symbols-outlined text-sm">
                                                 {order.orderType === 'Delivery' ? 'local_shipping' : 'storefront'}
                                             </span>
                                             {order.orderType}
                                         </span>
                                         <p className="text-xs font-bold text-primary">{formatCurrency(order.total)}</p>
                                     </div>

                                     <p className="mt-2 text-sm font-semibold text-slate-700 dark:text-slate-200 line-clamp-2">{order.itemsSummary}</p>
                                     <p className="text-xs text-gray-500 mt-1">{order.customerName}</p>
                                     {!!order.customerPhone && <p className="text-xs text-gray-500">{order.customerPhone}</p>}

                                     <div className="mt-3">
                                         {renderOrderActions(order, true)}
                                     </div>
                                 </article>
                             );
                         })}
                         {isLoadingMore && (
                             <div className="rounded-xl border border-gray-100 dark:border-slate-700 p-4 text-center text-xs font-semibold text-slate-500">
                                 Loading more orders...
                             </div>
                         )}
                     </div>

                     <div className="hidden lg:block overflow-x-auto">
                     <table className="w-full min-w-[940px] text-left">
                         <thead className="bg-gray-50 dark:bg-slate-700/50 border-b border-gray-100 dark:border-slate-700">
                             <tr>
                                 <th className="px-6 py-4 font-bold text-gray-500 text-xs uppercase tracking-wider w-[100px]">Order ID</th>
                                 <th className="px-6 py-4 font-bold text-gray-500 text-xs uppercase tracking-wider w-[100px]">Type</th>
                                 <th className="px-6 py-4 font-bold text-gray-500 text-xs uppercase tracking-wider w-[200px]">Items</th>
                                 <th className="px-6 py-4 font-bold text-gray-500 text-xs uppercase tracking-wider w-[220px]">Status</th>
                                 <th className="px-6 py-4 font-bold text-gray-500 text-xs uppercase tracking-wider text-right">Actions</th>
                             </tr>
                         </thead>
                         <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                             {filteredOrders.map((order) => {
                                 const scheduledLabel = getScheduledLabel(order);
                                 return (
                                 <tr key={order.id} className="hover:bg-gray-50 dark:hover:bg-slate-700/30 transition-colors">
                                     <td className="px-6 py-4 align-top">
                                         <p className="font-bold text-sm">{order.id}</p>
                                         <p className="text-xs text-gray-400 mt-1">{getOrderTime(order.date)}</p>
                                         {scheduledLabel && <p className="text-[11px] font-semibold text-fuchsia-700 mt-1">Scheduled: {scheduledLabel}</p>}
                                     </td>
                                     <td className="px-6 py-4 align-top">
                                         <div className="flex flex-col gap-1">
                                             <span className={`text-xs font-bold flex items-center gap-1 ${order.orderType === 'Delivery' ? 'text-blue-600' : 'text-purple-600'}`}>
                                                 <span className="material-symbols-outlined text-sm">
                                                     {order.orderType === 'Delivery' ? 'local_shipping' : 'storefront'}
                                                 </span>
                                                 {order.orderType}
                                             </span>
                                             <p className="text-xs text-gray-400 font-medium">{order.customerName}</p>
                                             {!!order.customerPhone && <p className="text-xs text-gray-400 font-medium">{order.customerPhone}</p>}
                                         </div>
                                     </td>
                                     <td className="px-6 py-4 align-top">
                                         <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{order.itemsSummary}</p>
                                         <p className="text-xs font-bold text-primary mt-1">{formatCurrency(order.total)}</p>
                                     </td>
                                     <td className="px-6 py-4 align-top">
                                        <div className="flex items-center gap-1.5">
                                            <span className={`inline-flex px-2 py-1 rounded text-[10px] font-bold uppercase border whitespace-nowrap ${getStatusColor(order.status)}`}>
                                                {order.status}
                                            </span>
                                            {order.deliveryTiming === 'SCHEDULED' && (
                                                <span className="inline-flex px-2 py-1 rounded text-[10px] font-bold uppercase border whitespace-nowrap bg-fuchsia-100 text-fuchsia-700 border-fuchsia-200">
                                                    Scheduled
                                                </span>
                                            )}
                                            {order.refundStatus && (
                                                <span
                                                    className={`inline-flex px-2 py-1 rounded text-[10px] font-bold uppercase border whitespace-nowrap ${getRefundBadgeStyle(
                                                        order.refundStatus
                                                    )}`}
                                                >
                                                    {getRefundFilterLabel(order)}
                                                </span>
                                            )}
                                        </div>
                                     </td>
                                     <td className="px-6 py-4 align-top text-right">
                                        {renderOrderActions(order)}
                                     </td>
                                 </tr>
                             )})}
                         </tbody>
                     </table>
                     </div>

                     {filteredOrders.length === 0 && (
                         <div className="p-12 text-center text-gray-400">
                             <span className="material-symbols-outlined text-4xl mb-2">inbox</span>
                             <p>No orders match the current filter/search.</p>
                         </div>
                     )}

                     {filteredOrders.length > 0 && hasMore && (
                         <div className="border-t border-gray-100 dark:border-slate-700 p-4 flex justify-center">
                             <button
                                 onClick={loadMoreOrders}
                                 disabled={isLoadingMore}
                                 className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors ${
                                     isLoadingMore
                                         ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                         : 'bg-primary text-white hover:bg-primary/90'
                                 }`}
                             >
                                 {isLoadingMore ? 'Loading...' : 'Load More Orders'}
                             </button>
                         </div>
                     )}
                 </>
             )}
          </div>
       </main>

       {confirmDialog && (
         <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
           <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={closeConfirmation} />
           <div className="relative w-full max-w-md rounded-2xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl p-6">
             <h3 className="text-lg font-extrabold tracking-tight">{confirmDialog.title}</h3>
             <p className="text-sm text-slate-600 dark:text-slate-300 mt-2">{confirmDialog.message}</p>
             <div className="mt-6 flex justify-end gap-3">
               <button
                 onClick={closeConfirmation}
                 className="px-4 py-2 rounded-lg text-sm font-semibold bg-gray-100 hover:bg-gray-200 text-gray-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
               >
                 Keep Current Status
               </button>
               <button
                 onClick={confirmAction}
                 className={`px-4 py-2 rounded-lg text-sm font-bold text-white ${
                   confirmDialog.confirmVariant === 'danger'
                     ? 'bg-red-600 hover:bg-red-700'
                     : 'bg-primary hover:bg-primary/90 text-background-dark'
                 }`}
               >
                 {confirmDialog.confirmLabel}
               </button>
             </div>
           </div>
         </div>
       )}
    </div>
  );
};

export default AdminOrders;
