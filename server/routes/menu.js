'use strict';

/**
 * Domain routes: menu
 * Pure extraction from server/index.js monolith — behavior preserved.
 */
const db = require('../db');
const multer = require('multer');
const r2Service = require('../r2Service');
const { requireAdmin, requireAuth, attachAuthIfPresent } = require('../middleware/auth');
const { toPositiveInteger, toNumber } = require('../lib/primitives');
const { syncCartWithStock } = require('../services/cartService');
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }
});


module.exports = function registerMenuRoutes(app) {

    app.get('/api/categories', async (req, res) => {
        try {
            // Get categories with a count of active items
            const query = `
                SELECT c.*, COUNT(m.id) as itemCount 
                FROM categories c 
                LEFT JOIN menu_items m ON c.id = m.category_id 
                GROUP BY c.id 
                ORDER BY c.sort_order ASC
            `;
            const [rows] = await db.query(query);
            const formatted = rows.map(row => ({
                id: row.id.toString(),
                name: row.name,
                icon: row.icon,
                itemCount: row.itemCount || 0,
                isActive: row.is_active === undefined || row.is_active === null ? true : Boolean(row.is_active)
            }));
            res.json(formatted);
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: 'Database error' });
        }
    });

    app.post('/api/categories', requireAdmin, async (req, res) => {
        const { name, icon } = req.body;
        try {
            const [maxRes] = await db.query('SELECT MAX(sort_order) as maxOrder FROM categories');
            const nextOrder = (maxRes[0].maxOrder || 0) + 1;
            const [result] = await db.query(
                'INSERT INTO categories (name, icon, sort_order) VALUES (?, ?, ?)',
                [name, icon, nextOrder]
            );
            res.status(201).json({ id: result.insertId.toString(), name, icon, itemCount: 0, isActive: true });
        } catch (err) {
            res.status(500).json({ error: 'Failed to create' });
        }
    });

    app.put('/api/categories/:id', requireAdmin, async (req, res) => {
        const { id } = req.params;
        const { name, icon, isActive } = req.body;
        try {
            if (name !== undefined) await db.query('UPDATE categories SET name = ? WHERE id = ?', [name, id]);
            if (icon !== undefined) await db.query('UPDATE categories SET icon = ? WHERE id = ?', [icon, id]);
            if (isActive !== undefined) await db.query('UPDATE categories SET is_active = ? WHERE id = ?', [isActive ? 1 : 0, id]);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: 'Failed to update' });
        }
    });

    app.delete('/api/categories/:id', requireAdmin, async (req, res) => {
        try {
            await db.query('DELETE FROM categories WHERE id = ?', [req.params.id]);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: 'Failed to delete' });
        }
    });

    app.post('/api/categories/reorder', requireAdmin, async (req, res) => {
        const { categories } = req.body;
        if (!categories || !Array.isArray(categories)) return res.status(400).json({ error: 'Invalid data' });

        let connection = null;
        try {
            connection = await db.getConnection();
            await connection.beginTransaction();
            for (let i = 0; i < categories.length; i++) {
                await connection.query('UPDATE categories SET sort_order = ? WHERE id = ?', [i, categories[i].id]);
            }
            await connection.commit();
            res.json({ success: true });
        } catch (err) {
            if (connection) {
                await connection.rollback();
            }
            res.status(500).json({ error: 'Reorder failed' });
        } finally {
            if (connection) {
                connection.release();
            }
        }
    });

    // --- 4. MENU ITEM ROUTES ---

    // GET All Menu Items (With Category Name joined)
    app.get('/api/menu', async (req, res) => {
        try {
            const query = `
                SELECT m.*, c.name as category_name, c.is_active as category_is_active 
                FROM menu_items m
                LEFT JOIN categories c ON m.category_id = c.id
                ORDER BY COALESCE(c.sort_order, 2147483647) ASC, m.sort_order ASC, m.id ASC
            `;
            const [rows] = await db.query(query);

            const formatted = rows.map(row => ({
                id: row.id.toString(),
                name: row.name,
                description: row.description,
                price: parseFloat(row.price),
                image: row.image_url,
                category: row.category_name || 'Uncategorized',
                category_id: row.category_id ? row.category_id.toString() : null,
                sortOrder: Number(row.sort_order || 0),
                stock: row.stock,
                isActive: Boolean(row.is_active) && (row.category_is_active === null || Boolean(row.category_is_active)),
                itemIsActive: Boolean(row.is_active)
            }));

            res.json(formatted);
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: 'Failed to fetch menu' });
        }
    });

    // UPLOAD Image to Cloudflare R2
    app.post('/api/admin/upload', requireAdmin, upload.single('file'), async (req, res) => {
        try {
            if (!req.file) {
                return res.status(400).json({ error: 'No file uploaded' });
            }

            if (!r2Service.isR2Configured()) {
                return res.status(503).json({ error: 'Cloudflare R2 storage is not configured' });
            }

            const fileUrl = await r2Service.uploadFile(
                req.file.buffer,
                req.file.originalname,
                req.file.mimetype
            );

            res.json({ success: true, url: fileUrl });
        } catch (err) {
            console.error('[Upload] Failed to upload file:', err);
            res.status(500).json({ error: err.message || 'Failed to upload file to Cloudflare R2' });
        }
    });

    // CREATE Menu Item
    app.post('/api/menu', requireAdmin, async (req, res) => {
        const { name, description, price, image, category_id, stock } = req.body;
        try {
            const normalizedCategoryId =
                category_id === undefined || category_id === null || category_id === ''
                    ? null
                    : toPositiveInteger(category_id);
            if (category_id !== undefined && category_id !== null && category_id !== '' && normalizedCategoryId === null) {
                return res.status(400).json({ error: 'Invalid category_id' });
            }

            const [maxRes] = await db.query(
                `
                    SELECT COALESCE(MAX(sort_order), -1) AS maxSortOrder
                    FROM menu_items
                    WHERE ((category_id IS NULL AND ? IS NULL) OR category_id = ?)
                `,
                [normalizedCategoryId, normalizedCategoryId]
            );
            const nextSortOrder = Number(maxRes[0]?.maxSortOrder ?? -1) + 1;

            const [result] = await db.query(
                `INSERT INTO menu_items (name, description, price, image_url, category_id, stock, sort_order) 
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [name, description, price, image, normalizedCategoryId, stock || 100, nextSortOrder]
            );
            res.status(201).json({ success: true, id: result.insertId });
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: 'Failed to create menu item' });
        }
    });

    // UPDATE Menu Item
    app.put('/api/menu/:id', requireAdmin, async (req, res) => {
        const menuItemId = toPositiveInteger(req.params.id);
        const { name, description, price, image, category_id, stock, isActive } = req.body;
        if (!menuItemId) {
            return res.status(400).json({ error: 'Invalid menu item id' });
        }
        try {
            // Build dynamic query based on fields provided
            let fields = [];
            let values = [];

            const normalizedCategoryId =
                category_id === undefined
                    ? undefined
                    : category_id === null || category_id === ''
                        ? null
                        : toPositiveInteger(category_id);
            if (category_id !== undefined && category_id !== null && category_id !== '' && normalizedCategoryId === null) {
                return res.status(400).json({ error: 'Invalid category_id' });
            }

            let resolvedSortOrder;
            const rawSortOrder = req.body?.sortOrder ?? req.body?.sort_order;
            if (rawSortOrder !== undefined) {
                const parsedSortOrder = toNumber(rawSortOrder);
                if (parsedSortOrder === null) {
                    return res.status(400).json({ error: 'Invalid sort order' });
                }
                resolvedSortOrder = Math.max(0, Math.floor(parsedSortOrder));
            }

            const [existingRows] = await db.query(
                'SELECT category_id, image_url FROM menu_items WHERE id = ? LIMIT 1',
                [menuItemId]
            );
            if (existingRows.length === 0) {
                return res.status(404).json({ error: 'Menu item not found' });
            }
            const existingCategoryId =
                existingRows[0].category_id === null ? null : Number(existingRows[0].category_id);
            const existingImage = existingRows[0].image_url;

            // If the image is changed, delete the old one from R2
            if (image !== undefined && image !== existingImage && existingImage) {
                r2Service.deleteFile(existingImage).catch((err) => {
                    console.error('[Upload] Failed to delete previous image from R2 on update:', err);
                });
            }

            if (normalizedCategoryId !== undefined) {
                const categoryChanged = existingCategoryId !== normalizedCategoryId;

                if (categoryChanged && resolvedSortOrder === undefined) {
                    const [maxRes] = await db.query(
                        `
                            SELECT COALESCE(MAX(sort_order), -1) AS maxSortOrder
                            FROM menu_items
                            WHERE ((category_id IS NULL AND ? IS NULL) OR category_id = ?)
                        `,
                        [normalizedCategoryId, normalizedCategoryId]
                    );
                    resolvedSortOrder = Number(maxRes[0]?.maxSortOrder ?? -1) + 1;
                }
            }

            if (name !== undefined) { fields.push('name = ?'); values.push(name); }
            if (description !== undefined) { fields.push('description = ?'); values.push(description); }
            if (price !== undefined) { fields.push('price = ?'); values.push(price); }
            if (image !== undefined) { fields.push('image_url = ?'); values.push(image); }
            if (normalizedCategoryId !== undefined) { fields.push('category_id = ?'); values.push(normalizedCategoryId); }
            if (resolvedSortOrder !== undefined) { fields.push('sort_order = ?'); values.push(resolvedSortOrder); }
            if (stock !== undefined) { fields.push('stock = ?'); values.push(stock); }
            if (isActive !== undefined) { fields.push('is_active = ?'); values.push(isActive); }

            if (fields.length === 0) return res.json({ success: true }); // Nothing to update

            values.push(menuItemId);
            const query = `UPDATE menu_items SET ${fields.join(', ')} WHERE id = ?`;

            await db.query(query, values);
            if (stock !== undefined || isActive !== undefined) {
                await syncCartWithStock(db);
            }
            res.json({ success: true });
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: 'Failed to update item' });
        }
    });

    // DELETE Menu Item
    app.delete('/api/menu/:id', requireAdmin, async (req, res) => {
        try {
            const menuItemId = toPositiveInteger(req.params.id);
            if (!menuItemId) {
                return res.status(400).json({ error: 'Invalid menu item id' });
            }

            // Fetch the existing item to get the image URL
            const [existing] = await db.query('SELECT image_url FROM menu_items WHERE id = ? LIMIT 1', [menuItemId]);
            if (existing.length > 0 && existing[0].image_url) {
                // Delete from R2 (non-blocking)
                r2Service.deleteFile(existing[0].image_url).catch((err) => {
                    console.error('[Upload] Failed to delete image from R2 on product delete:', err);
                });
            }

            await db.query('DELETE FROM menu_items WHERE id = ?', [menuItemId]);
            res.json({ success: true });
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: 'Failed to delete item' });
        }
    });

    app.post('/api/menu/reorder', requireAdmin, async (req, res) => {
        const items = Array.isArray(req.body?.items) ? req.body.items : null;
        if (!items) {
            return res.status(400).json({ error: 'Invalid data' });
        }

        const normalizedItems = [];
        for (const item of items) {
            const id = toPositiveInteger(item?.id);
            const rawCategoryId = item?.category_id;
            const categoryId =
                rawCategoryId === undefined || rawCategoryId === null || rawCategoryId === ''
                    ? null
                    : toPositiveInteger(rawCategoryId);
            if (!id || (rawCategoryId !== undefined && rawCategoryId !== null && rawCategoryId !== '' && categoryId === null)) {
                return res.status(400).json({ error: 'Invalid menu reorder payload' });
            }
            normalizedItems.push({ id, categoryId });
        }

        let connection = null;
        try {
            connection = await db.getConnection();
            await connection.beginTransaction();

            const nextOrderByCategory = new Map();
            for (const item of normalizedItems) {
                const categoryKey = item.categoryId === null ? 'null' : String(item.categoryId);
                const nextOrder = nextOrderByCategory.get(categoryKey) || 0;
                await connection.query(
                    'UPDATE menu_items SET sort_order = ?, category_id = ? WHERE id = ?',
                    [nextOrder, item.categoryId, item.id]
                );
                nextOrderByCategory.set(categoryKey, nextOrder + 1);
            }

            await connection.commit();
            return res.json({ success: true });
        } catch (err) {
            if (connection) {
                await connection.rollback();
            }
            console.error(err);
            return res.status(500).json({ error: 'Reorder failed' });
        } finally {
            if (connection) {
                connection.release();
            }
        }
    });
};
