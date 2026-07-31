'use strict';

/**
 * Domain routes: cart
 * Pure extraction from server/index.js monolith — behavior preserved.
 */
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { syncCartWithStock, fetchCartForUser } = require('../services/cartService');
const { fetchShopStatus } = require('../services/shop');
const { toPositiveInteger, toNumber } = require('../lib/primitives');


module.exports = function registerCartRoutes(app) {

    app.get('/api/cart', requireAuth, async (req, res) => {
        try {
            const userId = req.user.id;
            const cart = await fetchCartForUser(userId);
            return res.json(cart);
        } catch (error) {
            console.error(error);
            return res.status(500).json({ error: 'Failed to fetch cart' });
        }
    });

    app.post('/api/cart/items', requireAuth, async (req, res) => {
        try {
            const userId = req.user.id;
            const menuItemId = toPositiveInteger(req.body?.menuItemId);
            const quantity = toPositiveInteger(req.body?.quantity || 1);

            if (!menuItemId || !quantity) {
                return res.status(400).json({ error: 'menuItemId and quantity are required' });
            }

            const shopStatus = await fetchShopStatus(db);
            if (!shopStatus.isOrderable) {
                return res.status(403).json({ error: shopStatus.message, shopStatus });
            }

            await syncCartWithStock(db, userId);

            const [menuRows] = await db.query(
                `
                    SELECT m.id, m.stock, m.is_active, c.is_active as category_is_active 
                    FROM menu_items m
                    LEFT JOIN categories c ON c.id = m.category_id
                    WHERE m.id = ? 
                    LIMIT 1
                `,
                [menuItemId]
            );
            if (menuRows.length === 0) {
                return res.status(404).json({ error: 'Menu item not found' });
            }
            const menuItem = menuRows[0];
            const availableStock = Number(menuItem.stock || 0);
            const isItemActive = menuItem.is_active && (menuItem.category_is_active === null || Boolean(menuItem.category_is_active));
            if (!isItemActive || availableStock <= 0) {
                return res.status(400).json({ error: 'This item is out of stock' });
            }

            const [existingRows] = await db.query(
                'SELECT quantity FROM cart_items WHERE user_id = ? AND menu_item_id = ? LIMIT 1',
                [userId, menuItemId]
            );
            const currentQuantity = existingRows.length ? Number(existingRows[0].quantity || 0) : 0;
            const nextQuantity = currentQuantity + quantity;
            if (nextQuantity > availableStock) {
                return res.status(400).json({
                    error: `Only ${availableStock} stock left for this item`
                });
            }

            await db.query(
                `
                    INSERT INTO cart_items (user_id, menu_item_id, quantity)
                    VALUES (?, ?, ?)
                    ON DUPLICATE KEY UPDATE quantity = VALUES(quantity)
                `,
                [userId, menuItemId, nextQuantity]
            );

            const cart = await fetchCartForUser(userId);
            return res.json(cart);
        } catch (error) {
            console.error(error);
            return res.status(500).json({ error: 'Failed to add cart item' });
        }
    });

    app.put('/api/cart/items/:menuItemId', requireAuth, async (req, res) => {
        try {
            const userId = req.user.id;
            const menuItemId = toPositiveInteger(req.params.menuItemId);
            const quantity = toNumber(req.body?.quantity);

            if (!menuItemId || quantity === null) {
                return res.status(400).json({ error: 'menuItemId and quantity are required' });
            }

            const shopStatus = await fetchShopStatus(db);
            if (!shopStatus.isOrderable) {
                return res.status(403).json({ error: shopStatus.message, shopStatus });
            }

            await syncCartWithStock(db, userId);

            if (quantity <= 0) {
                await db.query(
                    'DELETE FROM cart_items WHERE user_id = ? AND menu_item_id = ?',
                    [userId, menuItemId]
                );
            } else {
                const [menuRows] = await db.query(
                    `
                        SELECT m.id, m.stock, m.is_active, c.is_active as category_is_active 
                        FROM menu_items m
                        LEFT JOIN categories c ON c.id = m.category_id
                        WHERE m.id = ? 
                        LIMIT 1
                    `,
                    [menuItemId]
                );
                if (menuRows.length === 0) {
                    return res.status(404).json({ error: 'Menu item not found' });
                }
                const menuItem = menuRows[0];
                const availableStock = Number(menuItem.stock || 0);
                const isItemActive = menuItem.is_active && (menuItem.category_is_active === null || Boolean(menuItem.category_is_active));
                if (!isItemActive || availableStock <= 0) {
                    return res.status(400).json({ error: 'This item is out of stock' });
                }
                const normalizedQuantity = Math.floor(quantity);
                if (normalizedQuantity <= 0) {
                    await db.query(
                        'DELETE FROM cart_items WHERE user_id = ? AND menu_item_id = ?',
                        [userId, menuItemId]
                    );
                    const cart = await fetchCartForUser(userId);
                    return res.json(cart);
                }
                if (normalizedQuantity > availableStock) {
                    return res.status(400).json({
                        error: `Only ${availableStock} stock left for this item`
                    });
                }

                await db.query(
                    `
                        INSERT INTO cart_items (user_id, menu_item_id, quantity)
                        VALUES (?, ?, ?)
                        ON DUPLICATE KEY UPDATE quantity = VALUES(quantity)
                    `,
                    [userId, menuItemId, normalizedQuantity]
                );
            }

            const cart = await fetchCartForUser(userId);
            return res.json(cart);
        } catch (error) {
            console.error(error);
            return res.status(500).json({ error: 'Failed to update cart item' });
        }
    });

    app.delete('/api/cart/items/:menuItemId', requireAuth, async (req, res) => {
        try {
            const userId = req.user.id;
            const menuItemId = toPositiveInteger(req.params.menuItemId);
            if (!menuItemId) {
                return res.status(400).json({ error: 'Invalid menuItemId' });
            }

            await db.query(
                'DELETE FROM cart_items WHERE user_id = ? AND menu_item_id = ?',
                [userId, menuItemId]
            );
            const cart = await fetchCartForUser(userId);
            return res.json(cart);
        } catch (error) {
            console.error(error);
            return res.status(500).json({ error: 'Failed to delete cart item' });
        }
    });

    app.delete('/api/cart/clear', requireAuth, async (req, res) => {
        try {
            const userId = req.user.id;
            await db.query('DELETE FROM cart_items WHERE user_id = ?', [userId]);
            return res.json({ success: true });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ error: 'Failed to clear cart' });
        }
    });

};
