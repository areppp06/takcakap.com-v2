'use strict';

/**
 * Domain routes: adminSales
 * Pure extraction from server/index.js monolith — behavior preserved.
 */
const db = require('../db');
const { SHOP_TIMEZONE, MS_PER_DAY } = require('../config');
const { requireAdmin } = require('../middleware/auth');
const {
    computeGrowthPercentage,
    formatKlDate,
    getSalesOverviewRanges,
    parseKlDateInput,
    toCsvValue
} = require('../services/sales');
const { formatScheduledAtLabel } = require('../services/lalamoveHelpers');
const { toSqlDateTimeUtc, toUtcIsoString } = require('../lib/primitives');


module.exports = function registerAdminSalesRoutes(app) {

    app.get('/api/admin/sales/overview', requireAdmin, async (_req, res) => {
        try {
            const ranges = getSalesOverviewRanges(Date.now());
            const dayCurrentStartSql = toSqlDateTimeUtc(new Date(ranges.day.currentStartMs));
            const dayCurrentEndSql = toSqlDateTimeUtc(new Date(ranges.day.currentEndMs));
            const dayPreviousStartSql = toSqlDateTimeUtc(new Date(ranges.day.previousStartMs));
            const dayPreviousEndSql = toSqlDateTimeUtc(new Date(ranges.day.previousEndMs));
            const weekCurrentStartSql = toSqlDateTimeUtc(new Date(ranges.week.currentStartMs));
            const weekCurrentEndSql = toSqlDateTimeUtc(new Date(ranges.week.currentEndMs));
            const weekPreviousStartSql = toSqlDateTimeUtc(new Date(ranges.week.previousStartMs));
            const weekPreviousEndSql = toSqlDateTimeUtc(new Date(ranges.week.previousEndMs));
            const monthCurrentStartSql = toSqlDateTimeUtc(new Date(ranges.month.currentStartMs));
            const monthCurrentEndSql = toSqlDateTimeUtc(new Date(ranges.month.currentEndMs));
            const monthPreviousStartSql = toSqlDateTimeUtc(new Date(ranges.month.previousStartMs));
            const monthPreviousEndSql = toSqlDateTimeUtc(new Date(ranges.month.previousEndMs));

            const [rows] = await db.query(
                `
                    SELECT
                        COALESCE(SUM(CASE WHEN created_at >= ? AND created_at < ? THEN total_amount - COALESCE(refund_amount, 0) ELSE 0 END), 0) AS daily_sales,
                        COALESCE(SUM(CASE WHEN created_at >= ? AND created_at < ? THEN total_amount - COALESCE(refund_amount, 0) ELSE 0 END), 0) AS daily_sales_prev,
                        COALESCE(SUM(CASE WHEN created_at >= ? AND created_at < ? THEN total_amount - COALESCE(refund_amount, 0) ELSE 0 END), 0) AS weekly_sales,
                        COALESCE(SUM(CASE WHEN created_at >= ? AND created_at < ? THEN total_amount - COALESCE(refund_amount, 0) ELSE 0 END), 0) AS weekly_sales_prev,
                        COALESCE(SUM(CASE WHEN created_at >= ? AND created_at < ? THEN total_amount - COALESCE(refund_amount, 0) ELSE 0 END), 0) AS monthly_sales,
                        COALESCE(SUM(CASE WHEN created_at >= ? AND created_at < ? THEN total_amount - COALESCE(refund_amount, 0) ELSE 0 END), 0) AS monthly_sales_prev,
                        COALESCE(SUM(CASE WHEN created_at >= ? AND created_at < ? THEN 1 ELSE 0 END), 0) AS daily_orders,
                        COALESCE(SUM(CASE WHEN created_at >= ? AND created_at < ? THEN 1 ELSE 0 END), 0) AS weekly_orders,
                        COALESCE(SUM(CASE WHEN created_at >= ? AND created_at < ? THEN 1 ELSE 0 END), 0) AS monthly_orders
                    FROM orders
                    WHERE status <> 'Cancelled' AND status <> 'Pending Payment'
                `,
                [
                    dayCurrentStartSql,
                    dayCurrentEndSql,
                    dayPreviousStartSql,
                    dayPreviousEndSql,
                    weekCurrentStartSql,
                    weekCurrentEndSql,
                    weekPreviousStartSql,
                    weekPreviousEndSql,
                    monthCurrentStartSql,
                    monthCurrentEndSql,
                    monthPreviousStartSql,
                    monthPreviousEndSql,
                    dayCurrentStartSql,
                    dayCurrentEndSql,
                    weekCurrentStartSql,
                    weekCurrentEndSql,
                    monthCurrentStartSql,
                    monthCurrentEndSql
                ]
            );

            const stats = rows[0] || {};
            const dailySales = Number(stats.daily_sales || 0);
            const dailySalesPrev = Number(stats.daily_sales_prev || 0);
            const weeklySales = Number(stats.weekly_sales || 0);
            const weeklySalesPrev = Number(stats.weekly_sales_prev || 0);
            const monthlySales = Number(stats.monthly_sales || 0);
            const monthlySalesPrev = Number(stats.monthly_sales_prev || 0);
            const dailyOrders = Number(stats.daily_orders || 0);
            const weeklyOrders = Number(stats.weekly_orders || 0);
            const monthlyOrders = Number(stats.monthly_orders || 0);

            return res.json({
                timezone: SHOP_TIMEZONE,
                generatedAt: new Date().toISOString(),
                dailySales,
                weeklySales,
                monthlySales,
                dailyOrders,
                weeklyOrders,
                monthlyOrders,
                dailyGrowthPct: computeGrowthPercentage(dailySales, dailySalesPrev),
                weeklyGrowthPct: computeGrowthPercentage(weeklySales, weeklySalesPrev),
                monthlyGrowthPct: computeGrowthPercentage(monthlySales, monthlySalesPrev)
            });
        } catch (error) {
            console.error('Failed to load admin sales overview:', error);
            return res.status(500).json({ error: 'Failed to fetch sales overview' });
        }
    });

    app.get('/api/admin/sales/report.csv', requireAdmin, async (req, res) => {
        try {
            const preset = String(req.query?.preset || 'month').trim().toLowerCase();
            const fromText = String(req.query?.from || '').trim();
            const toText = String(req.query?.to || '').trim();
            const usingCustomRange = Boolean(fromText || toText);

            let rangeStartUtcMs = 0;
            let rangeEndUtcMs = 0;
            let filenamePrefix = 'sales-report';

            if (usingCustomRange) {
                if (!fromText || !toText) {
                    return res.status(400).json({ error: 'Both from and to are required for custom range' });
                }
                const fromParsed = parseKlDateInput(fromText);
                const toParsed = parseKlDateInput(toText);
                if (!fromParsed || !toParsed) {
                    return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD for from and to.' });
                }
                if (fromParsed.startUtcMs > toParsed.startUtcMs) {
                    return res.status(400).json({ error: 'from date must be earlier than or equal to to date' });
                }
                rangeStartUtcMs = fromParsed.startUtcMs;
                rangeEndUtcMs = toParsed.startUtcMs + MS_PER_DAY;
                filenamePrefix = `sales-${fromParsed.raw}-to-${toParsed.raw}`;
            } else {
                const ranges = getSalesOverviewRanges(Date.now());
                if (preset === 'today') {
                    rangeStartUtcMs = ranges.day.currentStartMs;
                    rangeEndUtcMs = ranges.day.currentEndMs;
                    filenamePrefix = `sales-today-${formatKlDate(rangeStartUtcMs)}`;
                } else if (preset === 'week') {
                    rangeStartUtcMs = ranges.week.currentStartMs;
                    rangeEndUtcMs = ranges.week.currentEndMs;
                    filenamePrefix = `sales-week-${formatKlDate(rangeStartUtcMs)}`;
                } else {
                    rangeStartUtcMs = ranges.month.currentStartMs;
                    rangeEndUtcMs = ranges.month.currentEndMs;
                    filenamePrefix = `sales-month-${formatKlDate(rangeStartUtcMs)}`;
                }
            }

            const rangeStartSql = toSqlDateTimeUtc(new Date(rangeStartUtcMs));
            const rangeEndSql = toSqlDateTimeUtc(new Date(rangeEndUtcMs));

            const [rows] = await db.query(
                `
                    SELECT
                        o.id,
                        o.created_at,
                        o.status,
                        o.order_type,
                        o.payment_method,
                        o.total_amount,
                        o.refund_amount,
                        o.delivery_fee,
                        o.delivery_currency,
                        o.delivery_provider,
                        o.external_order_id,
                        o.tracking_url,
                        o.delivery_timing,
                        o.scheduled_at_utc,
                        o.delivery_address,
                        o.delivery_label_snapshot,
                        o.delivery_contact_phone,
                        o.delivery_note_snapshot,
                        o.delivery_latitude,
                        o.delivery_longitude,
                        o.recipient_name_snapshot,
                        u.name AS customer_name,
                        u.email AS customer_email,
                        (
                            SELECT GROUP_CONCAT(
                                 CONCAT(
                                    oi.quantity,
                                    'x ',
                                    COALESCE(NULLIF(TRIM(oi.item_name_snapshot), ''), m.name, CONCAT('Menu Item #', oi.menu_item_id))
                                 )
                                 SEPARATOR '; '
                            )
                            FROM order_items oi
                            LEFT JOIN menu_items m ON m.id = oi.menu_item_id
                            WHERE oi.order_id = o.id
                        ) AS items_summary
                    FROM orders o
                    LEFT JOIN users u ON u.id = o.user_id
                    WHERE o.status <> 'Cancelled'
                      AND o.status <> 'Pending Payment'
                      AND o.created_at >= ?
                      AND o.created_at < ?
                    ORDER BY o.created_at DESC
                `,
                [rangeStartSql, rangeEndSql]
            );

            const headers = [
                'Order ID',
                'Created At (MYT)',
                'Status',
                'Order Type',
                'Customer Name',
                'Customer Email',
                'Recipient Name',
                'Contact Phone',
                'Address Label',
                'Address',
                'Address Note',
                'Latitude',
                'Longitude',
                'Items',
                'Payment Method',
                'Delivery Provider',
                'Lalamove Order ID',
                'Tracking URL',
                'Delivery Timing',
                'Scheduled At (MYT)',
                'Delivery Fee',
                'Total Amount',
                'Refund Amount',
                'Net Amount',
                'Currency'
            ];

            const csvLines = [headers.map(toCsvValue).join(',')];
            for (const row of rows) {
                const createdIso = toUtcIsoString(row.created_at);
                const createdMyt = createdIso
                    ? new Date(createdIso).toLocaleString('en-MY', {
                        timeZone: SHOP_TIMEZONE,
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                        hour12: false
                    })
                    : '';
                const scheduledMyt = row.scheduled_at_utc ? formatScheduledAtLabel(row.scheduled_at_utc) : '';

                const values = [
                    row.id,
                    createdMyt,
                    row.status || '',
                    row.order_type || '',
                    row.customer_name || '',
                    row.customer_email || '',
                    row.recipient_name_snapshot || '',
                    row.delivery_contact_phone || '',
                    row.delivery_label_snapshot || '',
                    row.delivery_address || '',
                    row.delivery_note_snapshot || '',
                    row.delivery_latitude ?? '',
                    row.delivery_longitude ?? '',
                    row.items_summary || '',
                    row.payment_method || '',
                    row.delivery_provider || '',
                    row.external_order_id || '',
                    row.tracking_url || '',
                    row.delivery_timing || '',
                    scheduledMyt,
                    Number(row.delivery_fee || 0).toFixed(2),
                    Number(row.total_amount || 0).toFixed(2),
                    Number(row.refund_amount || 0).toFixed(2),
                    Number((row.total_amount || 0) - (row.refund_amount || 0)).toFixed(2),
                    row.delivery_currency || 'MYR'
                ];
                csvLines.push(values.map(toCsvValue).join(','));
            }

            const filenameSafePrefix = filenamePrefix.replace(/[^a-zA-Z0-9._-]+/g, '-');
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="${filenameSafePrefix}.csv"`);
            return res.status(200).send(`\uFEFF${csvLines.join('\n')}`);
        } catch (error) {
            console.error('Failed to generate sales CSV report:', error);
            return res.status(500).json({ error: 'Failed to generate sales report CSV' });
        }
    });
};
