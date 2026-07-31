'use strict';

/**
 * Domain routes: adminCustomers
 * Pure extraction from server/index.js monolith — behavior preserved.
 */
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { toPositiveInteger } = require('../lib/primitives');


module.exports = function registerAdminCustomersRoutes(app) {

    app.get('/api/admin/customers', requireAdmin, async (req, res) => {
        try {
            const search = String(req.query?.search || '').trim();
            const status = String(req.query?.status || 'all').trim().toLowerCase();
            const where = [`u.role = 'user'`];
            const params = [];

            if (status === 'active') {
                where.push('COALESCE(u.is_suspended, 0) = 0');
            } else if (status === 'suspended') {
                where.push('COALESCE(u.is_suspended, 0) = 1');
            }

            if (search) {
                const like = `%${search}%`;
                where.push('(u.name LIKE ? OR u.email LIKE ? OR u.phone_number LIKE ?)');
                params.push(like, like, like);
            }

            const [rows] = await db.query(
                `
                    SELECT
                        u.id,
                        u.name,
                        u.email,
                        u.phone_number,
                        u.avatar_url,
                        u.created_at,
                        COALESCE(u.is_suspended, 0) AS is_suspended,
                        u.suspended_at,
                        COUNT(o.id) AS order_count,
                        COALESCE(SUM(o.total_amount - COALESCE(o.refund_amount, 0)), 0) AS total_spent,
                        MAX(o.created_at) AS last_order_at
                    FROM users u
                    LEFT JOIN orders o ON o.user_id = u.id AND o.status NOT IN ('Cancelled', 'Pending Payment')
                    WHERE ${where.join(' AND ')}
                    GROUP BY
                        u.id, u.name, u.email, u.phone_number, u.avatar_url, u.created_at, u.is_suspended, u.suspended_at
                    ORDER BY u.created_at DESC
                    LIMIT 500
                `,
                params
            );

            const [statsRows] = await db.query(
                `
                    SELECT
                        COUNT(*) AS total_customers,
                        SUM(
                            CASE
                                WHEN COALESCE(u.is_suspended, 0) = 0
                                     AND EXISTS (
                                         SELECT 1
                                         FROM orders o_recent
                                         WHERE o_recent.user_id = u.id
                                           AND o_recent.created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 7 DAY)
                                     )
                                THEN 1
                                ELSE 0
                            END
                        ) AS active_customers,
                        SUM(CASE WHEN COALESCE(u.is_suspended, 0) = 1 THEN 1 ELSE 0 END) AS suspended_customers,
                        SUM(CASE WHEN u.created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) AS new_this_week
                    FROM users u
                    WHERE u.role = 'user'
                `
            );
            const stats = statsRows[0] || {};

            return res.json({
                stats: {
                    totalCustomers: Number(stats.total_customers || 0),
                    activeCustomers: Number(stats.active_customers || 0),
                    suspendedCustomers: Number(stats.suspended_customers || 0),
                    newThisWeek: Number(stats.new_this_week || 0)
                },
                customers: rows.map((row) => ({
                    id: String(row.id),
                    name: row.name || 'Customer',
                    email: row.email || '',
                    phoneNumber: row.phone_number || '',
                    avatar: row.avatar_url || '',
                    isSuspended: Boolean(row.is_suspended),
                    suspendedAt: row.suspended_at ? new Date(row.suspended_at).toISOString() : null,
                    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
                    orderCount: Number(row.order_count || 0),
                    totalSpent: parseFloat(row.total_spent || 0),
                    lastOrderAt: row.last_order_at ? new Date(row.last_order_at).toISOString() : null
                }))
            });
        } catch (error) {
            console.error('Failed to load admin customers:', error);
            return res.status(500).json({ error: 'Failed to fetch customers' });
        }
    });

    app.get('/api/admin/customers/:id/orders', requireAdmin, async (req, res) => {
        try {
            const customerId = toPositiveInteger(req.params.id);
            if (!customerId) {
                return res.status(400).json({ error: 'Invalid customer id' });
            }

            const [userRows] = await db.query(
                `
                    SELECT id, name, email, phone_number, avatar_url, role, is_suspended, created_at
                    FROM users
                    WHERE id = ?
                    LIMIT 1
                `,
                [customerId]
            );
            const customer = userRows[0];
            if (!customer || customer.role !== 'user') {
                return res.status(404).json({ error: 'Customer not found' });
            }

            const [orders] = await db.query(
                `
                    SELECT
                        id,
                        status,
                        total_amount,
                        order_type,
                        delivery_provider,
                        tracking_url,
                        created_at
                    FROM orders
                    WHERE user_id = ?
                    ORDER BY created_at DESC
                    LIMIT 30
                `,
                [customerId]
            );
            const customerTotalSpent = orders.reduce(
                (sum, order) => sum + parseFloat(order.total_amount || 0),
                0
            );

            const orderIds = orders.map((order) => Number(order.id)).filter(Boolean);
            let itemsSummaryByOrderId = {};
            if (orderIds.length > 0) {
                const [itemsRows] = await db.query(
                    `
                        SELECT
                            oi.order_id,
                            GROUP_CONCAT(
                                CONCAT(
                                    oi.quantity,
                                    'x ',
                                    COALESCE(NULLIF(TRIM(oi.item_name_snapshot), ''), m.name, CONCAT('Menu Item #', oi.menu_item_id))
                                )
                                ORDER BY oi.id SEPARATOR ', '
                            ) AS items_summary
                        FROM order_items oi
                        LEFT JOIN menu_items m ON m.id = oi.menu_item_id
                        WHERE oi.order_id IN (?)
                        GROUP BY oi.order_id
                    `,
                    [orderIds]
                );
                itemsSummaryByOrderId = itemsRows.reduce((acc, row) => {
                    acc[Number(row.order_id)] = row.items_summary || '';
                    return acc;
                }, {});
            }

            return res.json({
                customer: {
                    id: String(customer.id),
                    name: customer.name || 'Customer',
                    email: customer.email || '',
                    phoneNumber: customer.phone_number || '',
                    avatar: customer.avatar_url || '',
                    isSuspended: Boolean(customer.is_suspended),
                    createdAt: customer.created_at ? new Date(customer.created_at).toISOString() : null,
                    orderCount: orders.length,
                    totalSpent: customerTotalSpent,
                    lastOrderAt: orders[0]?.created_at ? new Date(orders[0].created_at).toISOString() : null
                },
                orders: orders.map((order) => ({
                    id: String(order.id),
                    status: order.status,
                    orderType: order.order_type,
                    total: parseFloat(order.total_amount),
                    deliveryProvider: order.delivery_provider || 'Internal',
                    trackingUrl: order.tracking_url || null,
                    date: order.created_at ? new Date(order.created_at).toISOString() : null,
                    itemsSummary: itemsSummaryByOrderId[Number(order.id)] || ''
                }))
            });
        } catch (error) {
            console.error('Failed to load customer orders:', error);
            return res.status(500).json({ error: 'Failed to fetch customer orders' });
        }
    });

    app.patch('/api/admin/customers/:id/suspension', requireAdmin, async (req, res) => {
        try {
            const customerId = toPositiveInteger(req.params.id);
            if (!customerId) {
                return res.status(400).json({ error: 'Invalid customer id' });
            }

            const isSuspended = req.body?.isSuspended;
            if (typeof isSuspended !== 'boolean') {
                return res.status(400).json({ error: 'isSuspended must be a boolean' });
            }

            const [rows] = await db.query(
                `
                    SELECT id, role
                    FROM users
                    WHERE id = ?
                    LIMIT 1
                `,
                [customerId]
            );
            const targetUser = rows[0];
            if (!targetUser) {
                return res.status(404).json({ error: 'Customer not found' });
            }
            if (targetUser.role !== 'user') {
                return res.status(400).json({ error: 'Only customer accounts can be suspended' });
            }

            await db.query(
                `
                    UPDATE users
                    SET is_suspended = ?, suspended_at = ?
                    WHERE id = ?
                `,
                [isSuspended ? 1 : 0, isSuspended ? new Date() : null, customerId]
            );

            const [updatedRows] = await db.query(
                `
                    SELECT id, name, email, phone_number, avatar_url, is_suspended, suspended_at
                    FROM users
                    WHERE id = ?
                    LIMIT 1
                `,
                [customerId]
            );
            const updated = updatedRows[0];

            return res.json({
                success: true,
                customer: {
                    id: String(updated.id),
                    name: updated.name || 'Customer',
                    email: updated.email || '',
                    phoneNumber: updated.phone_number || '',
                    avatar: updated.avatar_url || '',
                    isSuspended: Boolean(updated.is_suspended),
                    suspendedAt: updated.suspended_at ? new Date(updated.suspended_at).toISOString() : null
                }
            });
        } catch (error) {
            console.error('Failed to update customer suspension:', error);
            return res.status(500).json({ error: 'Failed to update customer status' });
        }
    });
};
