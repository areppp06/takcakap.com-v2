export interface MenuItem {
  id: string;
  name: string;
  description: string;
  price: number;
  image: string;
  category: string;
  category_id?: string | null;
  sortOrder?: number;
  stock: number;
  isActive: boolean;
  itemIsActive?: boolean;
}

export interface Category {
  id: string;
  name: string;
  icon: string;
  itemCount: number;
  isActive?: boolean;
}

export type OrderStatus =
  | 'Pending Payment'
  | 'Waiting Kitchen'
  | 'Preparing'
  | 'Ready to Pickup'
  | 'Rider Picked Up'
  | 'Finding Rider'
  | 'Rider OTW'
  | 'Out For Delivery'
  | 'Completed'
  | 'Cancelled';

export interface Order {
  id: string;
  shortCode?: string | null;
  customerName: string;
  customerPhone?: string;
  customerAvatar?: string;
  recipientName?: string;
  date: string;
  status: OrderStatus;
  total: number;
  itemsSummary: string;
  orderType: 'Pickup' | 'Delivery';
  address?: string; // Optional because Pickup has no address
  addressLabel?: string;
  addressNote?: string;
  addressLatitude?: number;
  addressLongitude?: number;
  deliveryProvider?: 'Internal' | 'Lalamove';
  externalOrderId?: string;
  quotationId?: string;
  trackingUrl?: string;
  lalamoveStatus?: string;
  driverId?: string;
  paymentMethod?: string;
  deliveryFee?: number;
  deliveryCurrency?: string;
  deliveryTiming?: 'NOW' | 'SCHEDULED';
  scheduledAtUtc?: string;
  scheduledAtLabel?: string;
  canCancelLalamove?: boolean;
  cancelWindowMode?: 'OPEN_UNTIL_ASSIGNED' | 'LIMITED' | 'CLOSED';
  cancelWindowRemainingSeconds?: number | null;
  cancelWindowEndsAtUtc?: string | null;
  refundStatus?: 'pending' | 'processed' | 'failed';
  refundAmount?: number;
  refundId?: string;
  refundSpeedRequested?: string;
  refundSpeedProcessed?: string;
  refundRequestedAtUtc?: string;
  refundProcessedAtUtc?: string;
  refundFailedAtUtc?: string;
  refundFailureReason?: string;
  refundReason?: string;
  createdAtUtc?: string;
  updatedAtUtc?: string;
  refundEligibleUntilUtc?: string;
  refundWindowRemainingSeconds?: number;
  isRefundEligible?: boolean;
  canRequestRefund?: boolean;
}

export interface AdminOrdersPageResponse {
  items: Order[];
  hasMore: boolean;
  nextCursor?: string | null;
  pageSize: number;
  latestUpdatedAtUtc?: string | null;
  serverTimeUtc: string;
}

export interface AdminOrdersSyncResponse {
  changedOrderIds: string[];
  hasMore: boolean;
  latestUpdatedAtUtc?: string | null;
  serverTimeUtc: string;
}

export interface UserOrdersPageResponse {
  items: Order[];
  hasMore: boolean;
  nextCursor?: string | null;
  pageSize: number;
  latestUpdatedAtUtc?: string | null;
  serverTimeUtc: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  phoneNumber?: string;
  avatar: string;
  role: 'user' | 'admin';
  isSuspended?: boolean;
  isGoldMember?: boolean;
  totalOrders?: number;
}

export interface AdminCustomer {
  id: string;
  name: string;
  email: string;
  phoneNumber: string;
  avatar: string;
  isSuspended: boolean;
  suspendedAt?: string | null;
  createdAt?: string | null;
  orderCount: number;
  totalSpent: number;
  lastOrderAt?: string | null;
}

export interface AdminCustomerStats {
  totalCustomers: number;
  activeCustomers: number;
  suspendedCustomers: number;
  newThisWeek: number;
}

export interface AdminSalesOverview {
  timezone: string;
  generatedAt: string;
  dailySales: number;
  weeklySales: number;
  monthlySales: number;
  dailyOrders: number;
  weeklyOrders: number;
  monthlyOrders: number;
  dailyGrowthPct: number;
  weeklyGrowthPct: number;
  monthlyGrowthPct: number;
}

export interface AdminCustomerOrder {
  id: string;
  shortCode?: string | null;
  status: OrderStatus;
  orderType: 'Pickup' | 'Delivery';
  total: number;
  deliveryProvider?: 'Internal' | 'Lalamove';
  trackingUrl?: string | null;
  date?: string | null;
  itemsSummary: string;
}

export interface CartItem extends MenuItem {
  quantity: number;
}

export interface Address {
  id: string;
  name: string; // e.g. Home, Work
  addressLine: string;
  phone: string;
  note?: string;
  latitude?: number;
  longitude?: number;
}

export interface DeliveryQuoteStop {
  stopId: string;
  address: string;
  coordinates: {
    lat: string;
    lng: string;
  };
}

export interface DeliveryQuote {
  quotationId: string;
  expiresAt?: string;
  fee: number;
  currency: string;
  stops: DeliveryQuoteStop[];
  serviceType?: string;
}

export interface DeliveryOptions {
  pickupEnabled: boolean;
  lalamoveEnabled: boolean;
  remarkMaxLength?: number;
}

export interface PaymentOptions {
  duitnowQrUrl: string;
  duitnowEnabled: boolean;
  curlecEnabled: boolean;
  serviceFee: number;
  curlecConfigured: boolean;
  curlecKeyId: string;
  curlecDisplayName: string;
  curlecDescription: string;
}

export interface CurlecPaymentConfirmation {
  orderId: string;
  paymentId: string;
  signature: string;
}

export interface ShopStatus {
  openTime: string;
  closeTime: string;
  pauseOrders: boolean;
  storeName: string;
  storePhone: string;
  storeAddress: string;
  storeLatitude: number;
  storeLongitude: number;
  timezone: string;
  currentTime: string;
  isOpenBySchedule: boolean;
  isOrderable: boolean;
  reason: 'open' | 'closed' | 'paused';
  message: string;
}

export interface DeliveryRecipient {
  name: string;
  phone: string;
  remarks?: string;
}

export interface OrderAddressSnapshot {
  label?: string;
  addressLine: string;
  phone: string;
  note?: string;
  latitude?: number;
  longitude?: number;
}

export interface ReorderPreviewItem {
  menuItemId: string;
  name: string;
  image?: string;
  requestedQuantity: number;
  quantity: number;
  reason?: string;
}

export interface ReorderPreview {
  orderId: string;
  hasCurrentCart: boolean;
  requestedCount: number;
  addableCount: number;
  availableItems: ReorderPreviewItem[];
  adjustedItems: ReorderPreviewItem[];
  unavailableItems: ReorderPreviewItem[];
}

export interface CreateOrderPayload {
  userId?: string;
  items: any[];
  total: number;
  orderType: 'Pickup' | 'Delivery';
  address?: string;
  addressSnapshot?: OrderAddressSnapshot;
  status?: string;
  quotationId?: string;
  deliveryFee?: number;
  deliveryCurrency?: string;
  quotationStops?: DeliveryQuoteStop[];
  recipient?: DeliveryRecipient;
  paymentMethod?: string;
  voucherCode?: string;
  curlecPayment?: CurlecPaymentConfirmation;
  curlecCheckoutSessionId?: string;
  deliveryTiming?: 'NOW' | 'SCHEDULED';
  scheduledAtUtc?: string;
}
