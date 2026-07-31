/**
 * Order routes: admin list + sync
 */
'use strict';

const db = require('../../db');
const {
    ADMIN_ORDERS_DEFAULT_LIMIT,
    ADMIN_ORDERS_MAX_LIMIT,
    ADMIN_ORDER_SYNC_DEFAULT_LIMIT,
    ADMIN_ORDER_SYNC_MAX_LIMIT
} = require('../../config');
const { requireAdmin } = require('../../middleware/auth');
const { parsePositiveIntWithBounds, toPositiveInteger, toIsoUtcString } = require('../../lib/primitives');
const {
    formatOrderRowForClient,
    decodeAdminOrdersCursor,
    encodeAdminOrdersCursor,
    normalizeAdminDeliveryTiming,
    normalizeAdminOrderStatus,
    normalizeAdminRefundStatusFilter,
    normalizeAdminSearchQuery
} = require('../../services/orders/orderEvents');
const { fetchOrderSummariesByOrderIds } = require('../../services/orders/orderSummaries');

module.exports = function register(app) {


    app.get('/api/admin/orders', requireAdmin, async (req, res) => {
        try {
            const limit = parsePositiveIntWithBounds(req.query?.limit, {
                fallback: ADMIN_ORDERS_DEFAULT_LIMIT,
                min: 1,
                max: ADMIN_ORDERS_MAX_LIMIT
            });
            const statusFilter = normalizeAdminOrderStatus(req.query?.status);
            const refundStatusFilter = normalizeAdminRefundStatusFilter(req.query?.refundStatus);
            const deliveryTimingFilter = normalizeAdminDeliveryTiming(req.query?.deliveryTiming);
            const searchQuery = normalizeAdminSearchQuery(req.query?.q);
            const cursor = decodeAdminOrdersCursor(req.query?.cursor);

            const whereConditions = [];
            const queryParams = [];

            if (statusFilter) {
                whereConditions.push('o.status = ?');
                queryParams.push(statusFilter);
            }
            if (refundStatusFilter) {
                whereConditions.push('o.refund_status = ?');
                queryParams.push(refundStatusFilter);
            }
            if (deliveryTimingFilter) {
                whereConditions.push('o.delivery_timing = ?');
                queryParams.push(deliveryTimingFilter);
            }
            if (searchQuery) {
                const likeSearch = `%${searchQuery}%`;
                const numericSearch = searchQuery.replace(/\D+/g, '');
                const idFromSearch = toPositiveInteger(numericSearch);
                whereConditions.push(
                    `(
                        ${idFromSearch ? 'o.id = ? OR' : ''}
                        LOWER(COALESCE(o.short_code, '')) LIKE ?
                        OR LOWER(COALESCE(u.name, '')) LIKE ?
                        OR LOWER(COALESCE(o.delivery_contact_phone, '')) LIKE ?
                        OR LOWER(COALESCE(u.phone_number, '')) LIKE ?
                        OR EXISTS (
                            SELECT 1
                            FROM order_items soi
                            LEFT JOIN menu_items sm ON sm.id = soi.menu_item_id
                            WHERE soi.order_id = o.id
                              AND LOWER(COALESCE(NULLIF(TRIM(soi.item_name_snapshot), ''), sm.name, '')) LIKE ?
                        )
                    )`
                );
                if (idFromSearch) queryParams.push(idFromSearch);
                queryParams.push(likeSearch, likeSearch, likeSearch, likeSearch, likeSearch);
            }
            if (cursor) {
                whereConditions.push('(o.created_at < ? OR (o.created_at = ? AND o.id < ?))');
                queryParams.push(cursor.createdAtSql, cursor.createdAtSql, cursor.id);
            }
     
            const whereClause = whereConditions.length ? `WHERE ${whereConditions.join(' AND ')}` : '';
            const queryLimit = Math.max(1, Number(limit || ADMIN_ORDERS_DEFAULT_LIMIT));
     
            const [orderRows] = await db.query(
                `
                    SELECT
                        o.id,
                        o.short_code,
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
                        o.delivery_fee,
                        o.delivery_currency,
                        o.delivery_timing,
                        DATE_FORMAT(o.scheduled_at_utc, '%Y-%m-%dT%H:%i:%sZ') AS scheduled_at_utc_iso,
                        DATE_FORMAT(o.lalamove_ongoing_at, '%Y-%m-%dT%H:%i:%sZ') AS lalamove_ongoing_at_utc,
                        o.delivery_contact_phone,
                        o.delivery_label_snapshot,
                        o.delivery_note_snapshot,
                        o.delivery_latitude,
                        o.delivery_longitude,
                        o.recipient_name_snapshot,
                        u.name AS customer_name,
                        u.avatar_url,
                        u.phone_number AS account_phone
                    FROM orders o
                    LEFT JOIN users u ON o.user_id = u.id
                    ${whereClause}
                    ORDER BY o.created_at DESC, o.id DESC
                    LIMIT ?
                `,
                [...queryParams, queryLimit + 1]
            );

            const hasMore = orderRows.length > queryLimit;
            const pageRows = hasMore ? orderRows.slice(0, queryLimit) : orderRows;
            const nextRow = hasMore ? pageRows[pageRows.length - 1] : null;

            const summaryMap = await fetchOrderSummariesByOrderIds(
                pageRows.map((row) => row.id),
                db
            );

            const formattedItems = pageRows.map((row) =>
                formatOrderRowForClient({
                    ...row,
                    items_summary: summaryMap.get(toPositiveInteger(row.id)) || ''
                })
            );
            const latestUpdatedAtUtc = formattedItems.reduce((latest, item) => {
                const candidate = toIsoUtcString(item.updatedAtUtc || item.createdAtUtc);
                if (!candidate) return latest;
                if (!latest) return candidate;
                return new Date(candidate).getTime() > new Date(latest).getTime() ? candidate : latest;
            }, null);

            return res.json({
                items: formattedItems,
                hasMore,
                nextCursor: nextRow
                    ? encodeAdminOrdersCursor({
                        createdAtSql: nextRow.created_at_cursor || nextRow.created_at,
                        id: nextRow.id
                    })
                    : null,
                pageSize: queryLimit,
                latestUpdatedAtUtc,
                serverTimeUtc: new Date().toISOString()
            });
        } catch (error) {
            console.error('Failed to fetch admin orders:', error);
            return res.status(500).json({ error: 'Failed to fetch admin orders' });
        }
    });

    app.get('/api/admin/orders/sync', requireAdmin, async (req, res) => {
        try {
            const since = toIsoUtcString(req.query?.since);
            const limit = parsePositiveIntWithBounds(req.query?.limit, {
                fallback: ADMIN_ORDER_SYNC_DEFAULT_LIMIT,
                min: 1,
                max: ADMIN_ORDER_SYNC_MAX_LIMIT
            });
            if (!since) {
                return res.json({
                    changedOrderIds: [],
                    hasMore: false,
                    latestUpdatedAtUtc: null,
                    serverTimeUtc: new Date().toISOString()
                });
            }

            const [rows] = await db.query(
                `
                    SELECT
                        id,
                        DATE_FORMAT(updated_at, '%Y-%m-%dT%H:%i:%sZ') AS updated_at_utc_iso
                    FROM orders
                    WHERE updated_at > ?
                    ORDER BY updated_at DESC, id DESC
                    LIMIT ?
                `,
                [new Date(since), limit + 1]
            );

            const hasMore = rows.length > limit;
            const pageRows = hasMore ? rows.slice(0, limit) : rows;
            const changedOrderIds = pageRows
                .map((row) => toPositiveInteger(row.id))
                .filter((id) => id !== null)
                .map((id) => String(id));
            const latestUpdatedAtUtc = pageRows.reduce((latest, row) => {
                const candidate = toIsoUtcString(row.updated_at_utc_iso);
                if (!candidate) return latest;
                if (!latest) return candidate;
                return new Date(candidate).getTime() > new Date(latest).getTime() ? candidate : latest;
            }, since);

            return res.json({
                changedOrderIds,
                hasMore,
                latestUpdatedAtUtc,
                serverTimeUtc: new Date().toISOString()
            });
        } catch (error) {
            console.error('Failed to sync admin orders:', error);
            return res.status(500).json({ error: 'Failed to sync admin orders' });
        }
    });

};
