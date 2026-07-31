/**
 * Order routes: reorder preview + reorder
 */
'use strict';

const db = require('../../db');
const { requireAuth } = require('../../middleware/auth');
const { toPositiveInteger } = require('../../lib/primitives');
const { buildReorderPreview, fetchCartForUser, syncCartWithStock } = require('../../services/cartService');

module.exports = function register(app) {


    app.get('/api/orders/:id/reorder-preview', requireAuth, async (req, res) => {
        try {
            const orderId = toPositiveInteger(req.params.id);
            if (!orderId) {
                return res.status(400).json({ error: 'Invalid order id' });
            }
            const preview = await buildReorderPreview(db, {
                userId: req.user.id,
                orderId
            });
            return res.json(preview);
        } catch (error) {
            console.error('Reorder preview failed:', error);
            return res.status(error.status || 500).json({
                error: error.message || 'Failed to build reorder preview'
            });
        }
    });

    app.post('/api/orders/:id/reorder', requireAuth, async (req, res) => {
        const userId = req.user.id;
        const orderId = toPositiveInteger(req.params.id);
        const cartMode = String(req.body?.cartMode || 'replace').trim().toLowerCase() === 'merge' ? 'merge' : 'replace';

        if (!orderId) {
            return res.status(400).json({ error: 'Invalid order id' });
        }

        let connection = null;
        let hasTransaction = false;
        try {
            const preview = await buildReorderPreview(db, { userId, orderId });
            const candidates = [...preview.availableItems, ...preview.adjustedItems];
            if (!candidates.length) {
                return res.status(400).json({ error: 'No available items to reorder', preview });
            }

            connection = await db.getConnection();
            await connection.beginTransaction();
            hasTransaction = true;

            if (cartMode === 'replace') {
                await connection.query('DELETE FROM cart_items WHERE user_id = ?', [userId]);
            }

            let addedCount = 0;
            let skippedCount = 0;

            for (const item of candidates) {
                const menuItemId = toPositiveInteger(item.menuItemId);
                const requestedQuantity = toPositiveInteger(item.quantity);
                if (!menuItemId || !requestedQuantity) {
                    skippedCount += 1;
                    continue;
                }

                const [menuRows] = await connection.query(
                    `
                        SELECT m.stock, m.is_active, c.is_active as category_is_active
                        FROM menu_items m
                        LEFT JOIN categories c ON c.id = m.category_id
                        WHERE m.id = ?
                        LIMIT 1
                        FOR UPDATE
                    `,
                    [menuItemId]
                );
                const menuRow = menuRows[0];
                const isItemActive = menuRow && menuRow.is_active && (menuRow.category_is_active === null || Boolean(menuRow.category_is_active));
                if (!menuRow || !isItemActive || Number(menuRow.stock || 0) <= 0) {
                    skippedCount += 1;
                    continue;
                }

                const availableStock = Number(menuRow.stock || 0);
                let existingQuantity = 0;
                if (cartMode === 'merge') {
                    const [cartRows] = await connection.query(
                        `
                            SELECT quantity
                            FROM cart_items
                            WHERE user_id = ? AND menu_item_id = ?
                            LIMIT 1
                        `,
                        [userId, menuItemId]
                    );
                    existingQuantity = Number(cartRows[0]?.quantity || 0);
                }

                const finalQuantity = Math.min(existingQuantity + requestedQuantity, availableStock);
                if (finalQuantity <= 0) {
                    skippedCount += 1;
                    continue;
                }

                await connection.query(
                    `
                        INSERT INTO cart_items (user_id, menu_item_id, quantity)
                        VALUES (?, ?, ?)
                        ON DUPLICATE KEY UPDATE quantity = VALUES(quantity)
                    `,
                    [userId, menuItemId, finalQuantity]
                );
                addedCount += Math.max(finalQuantity - existingQuantity, 0);
            }

            await syncCartWithStock(connection, userId);
            await connection.commit();
            hasTransaction = false;

            const cart = await fetchCartForUser(userId);
            return res.json({
                success: true,
                cartMode,
                addedCount,
                skippedCount,
                preview,
                cart
            });
        } catch (error) {
            if (connection && hasTransaction) {
                await connection.rollback();
            }
            console.error('Reorder apply failed:', error);
            return res.status(error.status || 500).json({
                error: error.message || 'Failed to apply reorder'
            });
        } finally {
            if (connection) {
                connection.release();
            }
        }
    });

};
