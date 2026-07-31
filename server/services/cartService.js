/**
 * Cart stock sync + reorder preview.
 */
'use strict';

const db = require('../db');
const { toPositiveInteger } = require('../lib/primitives');

const syncCartWithStock = async (executor, userId = null) => {
    const hasUserFilter = userId !== null && userId !== undefined;
    const userFilterClause = hasUserFilter ? 'AND ci.user_id = ?' : '';
    const params = hasUserFilter ? [userId] : [];

    await executor.query(
        `
            UPDATE cart_items ci
            JOIN menu_items m ON m.id = ci.menu_item_id
            SET ci.quantity = m.stock
            WHERE ci.quantity > m.stock
              AND m.is_active = 1
              AND m.stock > 0
              ${userFilterClause}
        `,
        params
    );
};

const fetchCartForUser = async (userId) => {
    await syncCartWithStock(db, userId);

    const [rows] = await db.query(
        `
            SELECT
                ci.menu_item_id,
                ci.quantity,
                m.name,
                m.description,
                m.price,
                m.image_url,
                m.stock,
                m.is_active,
                c.name as category_name,
                c.is_active as category_is_active
            FROM cart_items ci
            JOIN menu_items m ON m.id = ci.menu_item_id
            LEFT JOIN categories c ON c.id = m.category_id
            WHERE ci.user_id = ?
            ORDER BY ci.id ASC
        `,
        [userId]
    );

    return rows.map((row) => ({
        id: String(row.menu_item_id),
        name: row.name,
        description: row.description,
        price: parseFloat(row.price),
        image: row.image_url,
        category: row.category_name || 'Uncategorized',
        stock: row.stock,
        isActive: Boolean(row.is_active) && (row.category_is_active === null || Boolean(row.category_is_active)),
        quantity: row.quantity
    }));
};

const buildReorderPreview = async (executor, { userId, orderId }) => {
    const [orderRows] = await executor.query(
        `
            SELECT id, user_id
            FROM orders
            WHERE id = ?
            LIMIT 1
        `,
        [orderId]
    );
    const orderRow = orderRows[0];
    if (!orderRow) {
        const error = new Error('Order not found');
        error.status = 404;
        throw error;
    }
    // Same 404 for not-owned as not-found to avoid order existence oracle.
    if (Number(orderRow.user_id) !== Number(userId)) {
        const error = new Error('Order not found');
        error.status = 404;
        throw error;
    }

    const [rows] = await executor.query(
        `
            SELECT
                oi.menu_item_id,
                oi.quantity,
                oi.item_name_snapshot,
                m.name AS menu_name,
                m.image_url,
                m.stock,
                m.is_active,
                c.is_active as category_is_active
            FROM order_items oi
            LEFT JOIN menu_items m ON m.id = oi.menu_item_id
            LEFT JOIN categories c ON c.id = m.category_id
            WHERE oi.order_id = ?
            ORDER BY oi.id ASC
        `,
        [orderId]
    );
    if (!rows.length) {
        const error = new Error('This order has no items to reorder');
        error.status = 400;
        throw error;
    }

    const availableItems = [];
    const adjustedItems = [];
    const unavailableItems = [];
    let requestedCount = 0;

    for (const row of rows) {
        const requestedQuantity = toPositiveInteger(row.quantity) || 1;
        requestedCount += requestedQuantity;
        const menuItemId = String(row.menu_item_id || '');
        const snapshotName = String(row.item_name_snapshot || '').trim();
        const liveName = String(row.menu_name || '').trim();
        const name = snapshotName || liveName || `Menu Item #${menuItemId || 'Unknown'}`;
        const image = row.image_url || '';
        const stock = Number(row.stock || 0);
        const isActive = Boolean(row.is_active) && (row.category_is_active === null || Boolean(row.category_is_active));

        if (!liveName) {
            unavailableItems.push({
                menuItemId,
                name,
                image,
                requestedQuantity,
                quantity: 0,
                reason: 'Item is no longer available'
            });
            continue;
        }
        if (!isActive) {
            unavailableItems.push({
                menuItemId,
                name,
                image,
                requestedQuantity,
                quantity: 0,
                reason: 'Item is currently unavailable'
            });
            continue;
        }
        if (stock <= 0) {
            unavailableItems.push({
                menuItemId,
                name,
                image,
                requestedQuantity,
                quantity: 0,
                reason: 'Out of stock'
            });
            continue;
        }

        const quantity = Math.min(requestedQuantity, stock);
        if (quantity < requestedQuantity) {
            adjustedItems.push({
                menuItemId,
                name,
                image,
                requestedQuantity,
                quantity,
                reason: `Only ${stock} left in stock`
            });
            continue;
        }

        availableItems.push({
            menuItemId,
            name,
            image,
            requestedQuantity,
            quantity
        });
    }

    const [cartCountRows] = await executor.query(
        'SELECT COUNT(*) AS total FROM cart_items WHERE user_id = ?',
        [userId]
    );
    const hasCurrentCart = Number(cartCountRows[0]?.total || 0) > 0;

    return {
        orderId: String(orderId),
        hasCurrentCart,
        requestedCount,
        addableCount: [...availableItems, ...adjustedItems].reduce(
            (total, item) => total + Number(item.quantity || 0),
            0
        ),
        availableItems,
        adjustedItems,
        unavailableItems
    };
};

module.exports = {
    syncCartWithStock,
    fetchCartForUser,
    buildReorderPreview
};
