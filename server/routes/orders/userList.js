/**
 * Order routes: user list GET /api/orders
 */
'use strict';

const db = require('../../db');
const { USER_ORDERS_DEFAULT_LIMIT, USER_ORDERS_MAX_LIMIT } = require('../../config');
const { attachAuthIfPresent } = require('../../middleware/auth');
const { parsePositiveIntWithBounds, toPositiveInteger } = require('../../lib/primitives');
const {
    formatOrderRowForClient,
    decodeAdminOrdersCursor,
    encodeAdminOrdersCursor
} = require('../../services/orders/orderEvents');
const { fetchOrderSummariesByOrderIds } = require('../../services/orders/orderSummaries');

module.exports = function register(app) {
    app.get('/api/orders', attachAuthIfPresent, async (req, res) => {
        try {
            const mineOnly = String(req.query?.mine || '') === '1';
            if (mineOnly && !req.user?.id) {
                return res.status(401).json({ error: 'Authentication required' });
            }
            if (mineOnly && req.user?.isSuspended && req.user?.role !== 'admin') {
                return res.status(403).json({ error: 'Your account is suspended. Please contact support.' });
            }
            if (!mineOnly) {
                if (!req.user?.id) {
                    return res.status(401).json({ error: 'Authentication required' });
                }
                if (req.user.role !== 'admin') {
                    return res.status(403).json({ error: 'Admin access required' });
                }
            }

            const shouldFilterByUser = mineOnly;
            const shouldPaginateMine = shouldFilterByUser;
            const queryLimit = shouldPaginateMine
                ? parsePositiveIntWithBounds(req.query?.limit, {
                    fallback: USER_ORDERS_DEFAULT_LIMIT,
                    min: 1,
                    max: USER_ORDERS_MAX_LIMIT
                })
                : null;
            const cursor = shouldFilterByUser ? decodeAdminOrdersCursor(req.query?.cursor) : null;

            const whereConditions = [];
            const params = [];
            if (shouldFilterByUser) {
                whereConditions.push('o.user_id = ?');
                params.push(req.user.id);
            }
            if (cursor) {
                whereConditions.push('(o.created_at < ? OR (o.created_at = ? AND o.id < ?))');
                params.push(cursor.createdAtSql, cursor.createdAtSql, cursor.id);
            }
            const whereClause = whereConditions.length ? `WHERE ${whereConditions.join(' AND ')}` : '';

            const [orders] = await db.query(
                `
                    SELECT 
                        o.id,
                        o.short_code,
                        v.code as voucher_code,
                        o.discount_amount as voucher_discount,
                        o.status,
                        o.total_amount,
                        o.created_at,
                        DATE_FORMAT(o.created_at, '%Y-%m-%d %H:%i:%s') AS created_at_cursor,
                        DATE_FORMAT(o.created_at, '%Y-%m-%dT%H:%i:%sZ') AS created_at_utc_iso,
                        DATE_FORMAT(o.updated_at, '%Y-%m-%dT%H:%i:%sZ') AS updated_at_utc_iso,
                        o.order_type,
                        o.delivery_address,
                        o.delivery_provider,
                        o.external_order_id,
                        o.quotation_id,
                        o.tracking_url,
                        o.driver_id,
                        o.lalamove_status,
                        o.delivery_booking_status,
                        o.delivery_booking_error,
                        o.delivery_booking_attempts,
                        o.delivery_fee,
                        o.delivery_currency,
                        o.delivery_timing,
                        DATE_FORMAT(o.scheduled_at_utc, '%Y-%m-%dT%H:%i:%sZ') AS scheduled_at_utc_iso,
                        o.payment_method,
                        o.refund_status,
                        o.refund_amount,
                        o.refund_id,
                        o.refund_speed_requested,
                        o.refund_speed_processed,
                        DATE_FORMAT(o.refund_requested_at, '%Y-%m-%dT%H:%i:%sZ') AS refund_requested_at_utc,
                        DATE_FORMAT(o.refund_processed_at, '%Y-%m-%dT%H:%i:%sZ') AS refund_processed_at_utc,
                        DATE_FORMAT(o.refund_failed_at, '%Y-%m-%dT%H:%i:%sZ') AS refund_failed_at_utc,
                        o.refund_failure_reason,
                        o.refund_reason,
                        o.delivery_label_snapshot,
                        o.delivery_note_snapshot,
                        o.delivery_latitude,
                        o.delivery_longitude,
                        o.recipient_name_snapshot,
                        o.delivery_contact_phone,
                        DATE_FORMAT(o.lalamove_ongoing_at, '%Y-%m-%dT%H:%i:%sZ') AS lalamove_ongoing_at_utc,
                        u.name as customer_name,
                        u.avatar_url,
                        u.phone_number as account_phone
                    FROM orders o
                    LEFT JOIN users u ON o.user_id = u.id
                    LEFT JOIN vouchers v ON o.voucher_id = v.id
                    ${whereClause}
                    ORDER BY o.created_at DESC, o.id DESC
                    ${queryLimit ? 'LIMIT ?' : ''}
                `,
                queryLimit ? [...params, queryLimit + 1] : params
            );

            let pageOrders = orders;
            let nextCursor = null;
            if (queryLimit && orders.length > queryLimit) {
                pageOrders = orders.slice(0, queryLimit);
                const last = pageOrders[pageOrders.length - 1];
                nextCursor = encodeAdminOrdersCursor({
                    createdAtSql: last.created_at_cursor,
                    createdAtUtc: last.created_at_utc_iso,
                    id: last.id
                });
            }

            const summaryMap = await fetchOrderSummariesByOrderIds(pageOrders.map((o) => o.id));
            const formatted = pageOrders.map((o) =>
                formatOrderRowForClient({
                    ...o,
                    items_summary: summaryMap.get(toPositiveInteger(o.id)) || ''
                })
            );

            if (shouldPaginateMine) {
                return res.json({
                    orders: formatted,
                    nextCursor,
                    limit: queryLimit
                });
            }
            return res.json(formatted);
        } catch (error) {
            console.error(error);
            return res.status(500).json({ error: 'Failed to fetch orders' });
        }
    });
};
