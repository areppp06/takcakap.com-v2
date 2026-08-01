import {
    Address,
    AdminOrdersPageResponse,
    AdminOrdersSyncResponse,
    AdminCustomer,
    AdminCustomerOrder,
    AdminCustomerStats,
    AdminSalesOverview,
    CartItem,
    Category,
    CreateOrderPayload,
    DeliveryOptions,
    PaymentOptions,
    DeliveryQuote,
    MenuItem,
    Order,
    UserOrdersPageResponse,
    ReorderPreview,
    ShopStatus
} from '../types';

const SERVER_URL = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '');
const AUTH_TOKEN_KEY = 'takcakap_auth_token';
const SERVER_HAS_API_SUFFIX = /\/api$/i.test(SERVER_URL);

const adminApiPath = (path: string) => (SERVER_HAS_API_SUFFIX ? path : `/api${path}`);

const buildUrl = (path: string, query?: Record<string, string | number | undefined>) => {
    const base = `${SERVER_URL}${path}`;
    const absolute = base.startsWith('http://') || base.startsWith('https://');
    const url = absolute ? new URL(base) : new URL(base, window.location.origin);

    if (query) {
        Object.entries(query).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') {
                url.searchParams.set(key, String(value));
            }
        });
    }

    return absolute ? url.toString() : `${url.pathname}${url.search}`;
};

const request = async <T>(path: string, options?: RequestInit, query?: Record<string, string | number | undefined>): Promise<T> => {
    const headers = new Headers(options?.headers || {});
    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    if (token) {
        headers.set('Authorization', `Bearer ${token}`);
    }

    const response = await fetch(buildUrl(path, query), {
        ...options,
        headers
    });
    if (!response.ok) {
        if (response.status === 502 || response.status === 503 || response.status === 504) {
            const lastReload = Number(sessionStorage.getItem('pwa_502_reload_timestamp') || '0');
            const now = Date.now();
            
            if (now - lastReload > 10000) { // 10 seconds cooldown
                // Store reload attempt and force page refresh to trigger Cloudflare's worker redirect
                sessionStorage.setItem('pwa_502_reload_timestamp', String(now));
                window.location.href = window.location.href; // Better than reload() for some PWA edge cases
                return new Promise(() => { }); // Halt execution of calling code
            } else {
                console.warn('⚠️ Prevented infinite reload loop due to persistent 502/503/504 error.');
            }
        }
        const payload = await response.json().catch(() => ({}));
        const detail = payload.error || payload.message;
        throw new Error(
            detail
                ? `${detail}${response.status ? ` (${response.status})` : ''}`
                : `Request failed: ${response.status}`
        );
    }

    // Clear reload timestamp on any successful API response
    sessionStorage.removeItem('pwa_502_reload_timestamp');
    return response.json() as Promise<T>;
};

/**
 * Normalize GET /orders?mine=1 payloads.
 * Current API: { items, hasMore, nextCursor, pageSize, ... }
 * Legacy modular stub: { orders, nextCursor, limit }
 * Very old: bare Order[]
 */
const normalizeUserOrdersPage = (
    payload: UserOrdersPageResponse | Order[] | { orders?: Order[]; items?: Order[]; nextCursor?: string | null; hasMore?: boolean; pageSize?: number; limit?: number; latestUpdatedAtUtc?: string | null; serverTimeUtc?: string } | null | undefined
): UserOrdersPageResponse => {
    if (Array.isArray(payload)) {
        return {
            items: payload,
            hasMore: false,
            nextCursor: null,
            pageSize: payload.length,
            latestUpdatedAtUtc: null,
            serverTimeUtc: new Date().toISOString()
        };
    }

    const raw = payload && typeof payload === 'object' ? payload : {};
    const items = Array.isArray((raw as UserOrdersPageResponse).items)
        ? (raw as UserOrdersPageResponse).items
        : Array.isArray((raw as { orders?: Order[] }).orders)
            ? ((raw as { orders: Order[] }).orders)
            : [];

    const nextCursor =
        (raw as UserOrdersPageResponse).nextCursor === undefined
            ? null
            : ((raw as UserOrdersPageResponse).nextCursor ?? null);
    const hasMore =
        typeof (raw as UserOrdersPageResponse).hasMore === 'boolean'
            ? Boolean((raw as UserOrdersPageResponse).hasMore)
            : Boolean(nextCursor);
    const pageSize =
        typeof (raw as UserOrdersPageResponse).pageSize === 'number'
            ? Number((raw as UserOrdersPageResponse).pageSize)
            : typeof (raw as { limit?: number }).limit === 'number'
                ? Number((raw as { limit: number }).limit)
                : items.length;

    return {
        items,
        hasMore,
        nextCursor,
        pageSize,
        latestUpdatedAtUtc: (raw as UserOrdersPageResponse).latestUpdatedAtUtc ?? null,
        serverTimeUtc: (raw as UserOrdersPageResponse).serverTimeUtc || new Date().toISOString()
    };
};

type AdminOrdersStreamListener = (eventName: string, rawData: string) => void;

const parseSseEventBlock = (rawBlock: string): { eventName: string; data: string } | null => {
    if (!rawBlock) return null;
    let eventName = 'message';
    const dataLines: string[] = [];

    for (const line of rawBlock.split('\n')) {
        if (!line || line.startsWith(':')) continue;
        const separatorIndex = line.indexOf(':');
        const field = separatorIndex >= 0 ? line.slice(0, separatorIndex) : line;
        const value = separatorIndex >= 0 ? line.slice(separatorIndex + 1).trimStart() : '';
        if (field === 'event' && value) {
            eventName = value;
        } else if (field === 'data') {
            dataLines.push(value);
        }
    }

    return {
        eventName,
        data: dataLines.join('\n')
    };
};

const streamAdminOrdersEvents = async ({
    streamToken,
    signal,
    onEvent
}: {
    streamToken: string;
    signal: AbortSignal;
    onEvent: AdminOrdersStreamListener;
}): Promise<void> => {
    const normalizedToken = String(streamToken || '').trim();
    if (!normalizedToken) {
        throw new Error('Missing admin stream token');
    }

    const response = await fetch(buildUrl(adminApiPath('/admin/orders/stream'), { t: Date.now() }), {
        method: 'GET',
        headers: {
            Accept: 'text/event-stream',
            Authorization: `Bearer ${normalizedToken}`
        },
        signal
    });

    if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        const message =
            payload?.error ||
            payload?.message ||
            `Admin stream request failed: ${response.status}`;
        throw new Error(message);
    }

    const reader = response.body?.getReader();
    if (!reader) {
        throw new Error('Admin stream response body is unavailable');
    }

    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true }).replace(/\r/g, '');

        let boundary = buffer.indexOf('\n\n');
        while (boundary >= 0) {
            const rawBlock = buffer.slice(0, boundary).trim();
            buffer = buffer.slice(boundary + 2);
            const parsedEvent = parseSseEventBlock(rawBlock);
            if (parsedEvent) {
                onEvent(parsedEvent.eventName, parsedEvent.data);
            }
            boundary = buffer.indexOf('\n\n');
        }
    }
};

export const api = {
    getAuthToken: (): string => localStorage.getItem(AUTH_TOKEN_KEY) || '',
    googleLogin: async (credential: string): Promise<{ token: string; user: any }> =>
        request<{ token: string; user: any }>(
            '/auth/google',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ credential })
            }
        ),
    adminLogin: async (email: string, password: string): Promise<{ token: string; user: any }> =>
        request<{ token: string; user: any }>(
            '/auth/admin/login',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            }
        ),
    registerAdminFcmToken: async (token: string, deviceInfo?: string): Promise<{ success: boolean; armed?: boolean }> =>
        request<{ success: boolean; armed?: boolean }>(
            adminApiPath('/admin/fcm-token'),
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, deviceInfo: deviceInfo || undefined })
            }
        ),
    unregisterAdminFcmToken: async (token?: string): Promise<{ success: boolean; deleted?: number }> =>
        request<{ success: boolean; deleted?: number }>(
            adminApiPath('/admin/fcm-token'),
            {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(token ? { token } : {})
            }
        ),
    getAdminFcmStatus: async (): Promise<{
        firebaseReady: boolean;
        tokenCount: number;
        freshTokenCount?: number;
        maxAgeDays?: number;
        tokens: Array<{
            tokenPreview: string;
            userId: number | null;
            deviceInfo: string | null;
            createdAt: string;
            updatedAt: string;
        }>;
    }> => request(adminApiPath('/admin/fcm-status')),
    testAdminFcm: async (): Promise<{
        success: boolean;
        tokenCount?: number;
        successCount?: number;
        failureCount?: number;
        error?: string;
    }> =>
        request(
            adminApiPath('/admin/fcm-test'),
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            }
        ),
    getMe: async (): Promise<{ user: any }> => request<{ user: any }>('/auth/me'),
    updateMyAccount: async (payload: { name?: string; phoneNumber?: string }): Promise<{ success: boolean; user?: any }> =>
        request<{ success: boolean; user?: any }>(
            '/account',
            {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            }
        ),

    checkStatus: async (): Promise<{ status: string; mode: 'server' }> => {
        try {
            const res = await fetch(buildUrl('/status'));
            if (res.ok) return { status: 'connected', mode: 'server' };
            throw new Error('Server unreachable');
        } catch (e) {
            return { status: 'disconnected', mode: 'server' };
        }
    },

    getCategories: async (): Promise<Category[]> => request<Category[]>('/categories'),
    addCategory: async (name: string, icon: string) =>
        request<{ id: string; name: string; icon: string; itemCount: number }>(
            '/categories',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, icon })
            }
        ),
    updateCategory: async (id: string, updates: Partial<Category>) =>
        request<{ success: boolean }>(
            `/categories/${id}`,
            {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updates)
            }
        ),
    deleteCategory: async (id: string) =>
        request<{ success: boolean }>(
            `/categories/${id}`,
            { method: 'DELETE' }
        ),
    reorderCategories: async (categories: Category[]) =>
        request<{ success: boolean }>(
            '/categories/reorder',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ categories })
            }
        ),

    getMenu: async (): Promise<MenuItem[]> => request<MenuItem[]>('/menu'),
    addMenuItem: async (item: Omit<MenuItem, 'id'> & { category_id: string }) =>
        request<{ success: boolean; id: number }>(
            '/menu',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(item)
            }
        ),
    updateMenuItem: async (id: string, updates: Partial<MenuItem> & { category_id?: string }) =>
        request<{ success: boolean }>(
            `/menu/${id}`,
            {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updates)
            }
        ),
    deleteMenuItem: async (id: string) =>
        request<{ success: boolean }>(
            `/menu/${id}`,
            { method: 'DELETE' }
        ),
    reorderMenuItems: async (items: Array<{ id: string; category_id?: string | null }>) =>
        request<{ success: boolean }>(
            '/menu/reorder',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ items })
            }
        ),
    uploadImage: async (file: File): Promise<{ success: boolean; url: string }> => {
        const formData = new FormData();
        formData.append('file', file);
        return request<{ success: boolean; url: string }>(
            adminApiPath('/admin/upload'),
            {
                method: 'POST',
                body: formData
            }
        );
    },

    getAdminCustomers: async (params?: {
        search?: string;
        status?: 'all' | 'active' | 'suspended';
    }): Promise<{ stats: AdminCustomerStats; customers: AdminCustomer[] }> =>
        request<{ stats: AdminCustomerStats; customers: AdminCustomer[] }>(
            adminApiPath('/admin/customers'),
            undefined,
            params
        ),
    getAdminCustomerOrders: async (
        customerId: string
    ): Promise<{ customer: AdminCustomer; orders: AdminCustomerOrder[] }> =>
        request<{ customer: AdminCustomer; orders: AdminCustomerOrder[] }>(
            adminApiPath(`/admin/customers/${customerId}/orders`)
        ),
    updateAdminCustomerSuspension: async (customerId: string, isSuspended: boolean) =>
        request<{ success: boolean; customer: AdminCustomer }>(
            adminApiPath(`/admin/customers/${customerId}/suspension`),
            {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ isSuspended })
            }
        ),
    getAdminSalesOverview: async (): Promise<AdminSalesOverview> =>
        request<AdminSalesOverview>(adminApiPath('/admin/sales/overview')),
    downloadAdminSalesReportCsv: async (params?: {
        preset?: 'today' | 'week' | 'month' | 'custom';
        from?: string;
        to?: string;
    }): Promise<Blob> => {
        const headers = new Headers();
        const token = localStorage.getItem(AUTH_TOKEN_KEY);
        if (token) {
            headers.set('Authorization', `Bearer ${token}`);
        }
        const response = await fetch(buildUrl(adminApiPath('/admin/sales/report.csv'), params), { headers });
        if (!response.ok) {
            const text = await response.text().catch(() => '');
            let message = text || `Request failed: ${response.status}`;
            try {
                const payload = JSON.parse(text);
                message = payload.error || payload.message || message;
            } catch { }
            throw new Error(message);
        }
        return response.blob();
    },

    getOrders: async (): Promise<Order[]> => request<Order[]>('/orders'),
    getAdminOrders: async (params?: {
        limit?: number;
        cursor?: string;
        status?: string;
        refundStatus?: 'pending' | 'processed' | 'failed';
        deliveryTiming?: 'NOW' | 'SCHEDULED';
        q?: string;
    }): Promise<AdminOrdersPageResponse> =>
        request<AdminOrdersPageResponse>(adminApiPath('/admin/orders'), undefined, params),
    getAdminOrdersSync: async (params: {
        since: string;
        limit?: number;
    }): Promise<AdminOrdersSyncResponse> =>
        request<AdminOrdersSyncResponse>(adminApiPath('/admin/orders/sync'), undefined, params),
    getAdminOrdersStreamToken: async (): Promise<{ token: string; expiresInSeconds: number }> =>
        request<{ token: string; expiresInSeconds: number }>(adminApiPath('/admin/orders/stream-token'), {
            method: 'POST'
        }),
    streamAdminOrdersEvents,
    getMyOrdersPage: async (params?: {
        limit?: number;
        cursor?: string;
    }): Promise<UserOrdersPageResponse> => {
        const payload = await request<UserOrdersPageResponse | Order[] | { orders?: Order[] }>('/orders', undefined, {
            mine: 1,
            ...params
        });
        return normalizeUserOrdersPage(payload);
    },
    getMyOrders: async (): Promise<Order[]> => {
        const payload = await request<UserOrdersPageResponse | Order[] | { orders?: Order[] }>('/orders', undefined, {
            mine: 1
        });
        return normalizeUserOrdersPage(payload).items || [];
    },
    createOrder: async (orderData: CreateOrderPayload) =>
        request<{
            success: boolean;
            orderId: string;
            shortCode?: string | null;
            externalOrderId?: string | null;
            trackingUrl?: string | null;
            lalamoveStatus?: string | null;
            deliveryTiming?: 'NOW' | 'SCHEDULED';
            scheduledAtUtc?: string | null;
        }>(
            '/orders',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(orderData)
            }
        ),
    createCurlecOrder: async (payload: { amount: number; currency?: string; orderPayload: CreateOrderPayload }) =>
        request<{
            success: boolean;
            keyId: string;
            orderId: string;
            amount: number;
            currency: string;
            checkoutSessionId: string;
            displayName: string;
            description: string;
            themeColor: string;
        }>(
            '/payments/curlec/order',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            }
        ),
    updateOrderStatus: async (id: string, status: string) =>
        request<{
            success: boolean;
            autoRefundAttempted?: boolean;
            autoRefundError?: string | null;
            refund?: {
                id?: string | null;
                status: 'pending' | 'processed' | 'failed';
                amount: number;
                speedRequested?: string | null;
                speedProcessed?: string | null;
                timeframe?: string;
                message?: string;
            } | null;
        }>(
            `/orders/${id}/status`,
            {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status })
            }
        ),
    cancelAdminOrder: async (id: string) =>
        request<{
            success: boolean;
            orderId: string;
            status: string;
            autoRefundAttempted?: boolean;
            autoRefundError?: string | null;
            refund?: {
                id?: string | null;
                status: 'pending' | 'processed' | 'failed';
                amount: number;
                speedRequested?: string | null;
                speedProcessed?: string | null;
                timeframe?: string;
                message?: string;
            } | null;
        }>(
            adminApiPath(`/admin/orders/${id}/cancel`),
            {
                method: 'POST'
            }
        ),
    retryAdminOrderDispatch: async (id: string) =>
        request<{
            success: boolean;
            orderId: string;
            externalOrderId?: string | null;
            trackingUrl?: string | null;
            status?: string;
            deliveryBookingStatus?: string;
            feeWarning?: string;
        }>(
            adminApiPath(`/admin/orders/${id}/retry-dispatch`),
            {
                method: 'POST'
            }
        ),
    refundAdminOrder: async (id: string, payload?: { amount?: number; reason?: string }) =>
        request<{
            success: boolean;
            orderId: string;
            status: string;
            refund: {
                id?: string | null;
                status: 'pending' | 'processed' | 'failed';
                amount: number;
                speedRequested?: string | null;
                speedProcessed?: string | null;
                timeframe?: string;
                message?: string;
            };
        }>(
            adminApiPath(`/admin/orders/${id}/refund`),
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload || {})
            }
        ),
    getReorderPreview: async (orderId: string): Promise<ReorderPreview> =>
        request<ReorderPreview>(`/orders/${orderId}/reorder-preview`),
    applyReorder: async (orderId: string, cartMode: 'replace' | 'merge' = 'replace') =>
        request<{
            success: boolean;
            cartMode: 'replace' | 'merge';
            addedCount: number;
            skippedCount: number;
            preview: ReorderPreview;
            cart: CartItem[];
        }>(
            `/orders/${orderId}/reorder`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ cartMode })
            }
        ),
    downloadOrderReceipt: async (id: string): Promise<Blob> => {
        const headers = new Headers();
        const token = localStorage.getItem(AUTH_TOKEN_KEY);
        if (token) {
            headers.set('Authorization', `Bearer ${token}`);
        }
        const response = await fetch(buildUrl(`/orders/${id}/receipt`), { headers });
        if (!response.ok) {
            const payload = await response.json().catch(() => ({}));
            throw new Error(payload.error || payload.message || `Request failed: ${response.status}`);
        }
        return response.blob();
    },

    getDeliveryQuote: async (payload: {
        addressLine: string;
        latitude: number;
        longitude: number;
        recipientName?: string;
        recipientPhone?: string;
        note?: string;
        deliveryTiming?: 'NOW' | 'SCHEDULED';
        scheduledAtUtc?: string;
    }): Promise<DeliveryQuote> =>
        request<DeliveryQuote>(
            '/delivery/quote',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            }
        ),
    getDeliveryOptions: async (): Promise<DeliveryOptions> =>
        request<DeliveryOptions>('/delivery-options'),
    getAdminDeliveryOptions: async (): Promise<DeliveryOptions> =>
        request<DeliveryOptions>(adminApiPath('/admin/delivery-options')),
    updateAdminDeliveryOptions: async (payload: Partial<DeliveryOptions>) =>
        request<{ success: boolean } & DeliveryOptions>(
            adminApiPath('/admin/delivery-options'),
            {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            }
        ),
    getPaymentOptions: async (): Promise<PaymentOptions> =>
        request<PaymentOptions>('/payment-options'),
    getAdminPaymentOptions: async (): Promise<PaymentOptions> =>
        request<PaymentOptions>(adminApiPath('/admin/payment-options')),
    updateAdminPaymentOptions: async (payload: Partial<PaymentOptions>) =>
        request<{ success: boolean } & PaymentOptions>(
            adminApiPath('/admin/payment-options'),
            {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            }
        ),
    getShopStatus: async (): Promise<ShopStatus> =>
        request<ShopStatus>('/shop-status'),
    getAdminShopSettings: async (): Promise<ShopStatus> =>
        request<ShopStatus>(adminApiPath('/admin/shop-settings')),
    updateAdminShopSettings: async (payload: Partial<Pick<ShopStatus, 'openTime' | 'closeTime' | 'pauseOrders'>>) =>
        request<{ success: boolean } & ShopStatus>(
            adminApiPath('/admin/shop-settings'),
            {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            }
        ),

    getAddresses: async (): Promise<Address[]> =>
        request<Address[]>('/addresses'),
    addAddress: async (
        address: Omit<Address, 'id'>
    ): Promise<Address> =>
        request<Address>(
            '/addresses',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(address)
            }
        ),
    updateAddress: async (
        id: string,
        address: Partial<Omit<Address, 'id'>>
    ): Promise<{ success: boolean }> =>
        request<{ success: boolean }>(
            `/addresses/${id}`,
            {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(address)
            }
        ),
    deleteAddress: async (id: string): Promise<{ success: boolean }> =>
        request<{ success: boolean }>(
            `/addresses/${id}`,
            { method: 'DELETE' }
        ),

    getCart: async (): Promise<CartItem[]> =>
        request<CartItem[]>('/cart'),
    addCartItem: async (menuItemId: string, quantity = 1): Promise<CartItem[]> =>
        request<CartItem[]>(
            '/cart/items',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ menuItemId, quantity })
            }
        ),
    updateCartItem: async (menuItemId: string, quantity: number): Promise<CartItem[]> =>
        request<CartItem[]>(
            `/cart/items/${menuItemId}`,
            {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ quantity })
            }
        ),
    removeCartItem: async (menuItemId: string): Promise<CartItem[]> =>
        request<CartItem[]>(
            `/cart/items/${menuItemId}`,
            { method: 'DELETE' }
        ),
    clearCart: async (): Promise<{ success: boolean }> =>
        request<{ success: boolean }>(
            '/cart/clear',
            { method: 'DELETE' }
        ),

    // --- Loyalty / points / vouchers ---
    getUserPoints: async (params?: { page?: number; limit?: number }) =>
        request<{
            balance: number;
            debtPoints?: number;
            debtMessage?: string | null;
            transactions: any[];
            totalTransactions: number;
            cooldownLimitHours?: number;
            cooldownEndsAt?: string;
        }>('/user/points', undefined, params),
    getUserPointTiers: async (): Promise<Array<{ id: number; points_required: number; discount_amount: number }>> =>
        request('/user/points/tiers'),
    redeemUserPoints: async (points: number) =>
        request<{ success: boolean; code: string; discountValue: number }>(
            '/user/points/redeem',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ points })
            }
        ),
    getUserVouchers: async (params?: { activeOnly?: boolean }) =>
        request<any[]>('/user/vouchers', undefined, {
            activeOnly: params?.activeOnly ? 'true' : undefined
        }),
    validateUserVoucher: async (payload: { code: string; subtotal?: number }) =>
        request<{ valid: boolean; voucher: any }>(
            '/user/vouchers/validate',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            }
        ),
    getUserVoucherSavings: async () =>
        request<{ totalSaved: number }>('/user/vouchers/savings'),

    getAdminPointsSettings: async () =>
        request<{ voucher_cooldown_hours: number }>(adminApiPath('/admin/points/settings')),
    updateAdminPointsSettings: async (payload: { voucher_cooldown_hours: number }) =>
        request<{ success: boolean }>(adminApiPath('/admin/points/settings'), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }),
    getAdminPointTiers: async () =>
        request<any[]>(adminApiPath('/admin/points/tiers')),
    createAdminPointTier: async (payload: {
        points_required: number;
        discount_amount: number;
        is_active?: boolean;
    }) =>
        request<{ success: boolean }>(adminApiPath('/admin/points/tiers'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }),
    updateAdminPointTier: async (
        id: number | string,
        payload: { points_required: number; discount_amount: number; is_active?: boolean }
    ) =>
        request<{ success: boolean }>(adminApiPath(`/admin/points/tiers/${id}`), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }),
    deleteAdminPointTier: async (id: number | string) =>
        request<{ success: boolean }>(adminApiPath(`/admin/points/tiers/${id}`), {
            method: 'DELETE'
        }),
    getAdminPointsUsers: async (params?: { page?: number; limit?: number }) =>
        request<{ users: any[]; total: number; totalPages: number }>(
            adminApiPath('/admin/points/users'),
            undefined,
            params
        ),
    adjustAdminPoints: async (payload: {
        userId: number | string;
        points: number;
        action: 'add' | 'deduct';
        description?: string;
    }) =>
        request<{
            success: boolean;
            balance?: number;
            debtPoints?: number;
            debtMessage?: string | null;
        }>(adminApiPath('/admin/points/adjust'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }),
    getAdminPointsStats: async () =>
        request<any>(adminApiPath('/admin/points/stats')),
    getAdminVouchers: async (params?: Record<string, string | number | undefined>) =>
        request<any>(adminApiPath('/admin/vouchers'), undefined, params),
    getAdminVoucherStats: async () =>
        request<any>(adminApiPath('/admin/vouchers/stats')),
    createAdminVoucher: async (payload: Record<string, unknown>) =>
        request<{ success: boolean }>(adminApiPath('/admin/vouchers'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }),
    toggleAdminVoucher: async (id: number | string) =>
        request<{ success: boolean }>(adminApiPath(`/admin/vouchers/${id}/toggle`), {
            method: 'PUT'
        }),
    deleteAdminVoucher: async (id: number | string) =>
        request<{ success: boolean }>(adminApiPath(`/admin/vouchers/${id}/delete`), {
            method: 'PUT'
        })
};
