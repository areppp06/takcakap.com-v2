'use strict';

/**
 * Domain routes: addresses
 * Pure extraction from server/index.js monolith — behavior preserved.
 */
const db = require('../db');
const lalamoveService = require('../lalamoveService');
const { requireAuth } = require('../middleware/auth');
const {
    isValidLatitude,
    isValidLongitude,
    toNumber,
    toPositiveInteger,
    roundCoordinate
} = require('../lib/primitives');


module.exports = function registerAddressesRoutes(app) {

    app.get('/api/addresses', requireAuth, async (req, res) => {
        try {
            const userId = req.user.id;
            const [rows] = await db.query(
                `
                    SELECT id, name, address_line, phone, note, latitude, longitude
                    FROM user_addresses
                    WHERE user_id = ?
                    ORDER BY id DESC
                `,
                [userId]
            );

            const formatted = rows.map((row) => ({
                id: String(row.id),
                name: row.name,
                addressLine: row.address_line,
                phone: row.phone || '',
                note: row.note || '',
                latitude: row.latitude !== null ? Number(row.latitude) : undefined,
                longitude: row.longitude !== null ? Number(row.longitude) : undefined
            }));

            return res.json(formatted);
        } catch (error) {
            console.error(error);
            return res.status(500).json({ error: 'Failed to fetch addresses' });
        }
    });

    app.post('/api/addresses', requireAuth, async (req, res) => {
        try {
            const userId = req.user.id;
            const { name, addressLine, phone, note, latitude, longitude } = req.body || {};
            const trimmedPhone = String(phone || '').trim();
            const trimmedAddressLine = String(addressLine || '').trim().slice(0, 200);

            if (!name || !trimmedAddressLine || !trimmedPhone) {
                return res.status(400).json({ error: 'name, addressLine, and phone are required' });
            }
            const normalizedPhone = lalamoveService.normalizePhone(trimmedPhone);
            if (!lalamoveService.isValidPhone(normalizedPhone)) {
                return res.status(400).json({ error: 'Invalid phone number format. Use E.164, e.g. +60123456789' });
            }

            const lat = toNumber(latitude);
            const lng = toNumber(longitude);
            if (lat === null || lng === null) {
                return res.status(400).json({ error: 'latitude and longitude are required' });
            }
            if (!isValidLatitude(lat) || !isValidLongitude(lng)) {
                return res.status(400).json({
                    error: 'Invalid coordinates. Latitude must be between -90 and 90, longitude between -180 and 180.'
                });
            }
            const normalizedLat = roundCoordinate(lat);
            const normalizedLng = roundCoordinate(lng);

            const trimmedNote = String(note || '').trim().slice(0, 66);
            const [result] = await db.query(
                `
                    INSERT INTO user_addresses (user_id, name, address_line, phone, note, latitude, longitude)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `,
                [userId, name, trimmedAddressLine, normalizedPhone, trimmedNote, normalizedLat, normalizedLng]
            );

            return res.status(201).json({
                id: String(result.insertId),
                name,
                addressLine: trimmedAddressLine,
                phone: normalizedPhone,
                note: trimmedNote,
                latitude: normalizedLat === null ? undefined : normalizedLat,
                longitude: normalizedLng === null ? undefined : normalizedLng
            });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ error: 'Failed to create address' });
        }
    });

    app.put('/api/addresses/:id', requireAuth, async (req, res) => {
        try {
            const userId = req.user.id;
            const addressId = toPositiveInteger(req.params.id);
            if (!addressId) {
                return res.status(400).json({ error: 'Invalid address id' });
            }

            const { name, addressLine, phone, note, latitude, longitude } = req.body || {};
            const fields = [];
            const values = [];

            if (name !== undefined) {
                fields.push('name = ?');
                values.push(name);
            }
            if (addressLine !== undefined) {
                const trimmedAddressLine = String(addressLine || '').trim().slice(0, 200);
                if (!trimmedAddressLine) {
                    return res.status(400).json({ error: 'addressLine is required' });
                }
                fields.push('address_line = ?');
                values.push(trimmedAddressLine);
            }
            if (phone !== undefined) {
                const trimmedPhone = String(phone || '').trim();
                if (!trimmedPhone) {
                    return res.status(400).json({ error: 'phone is required' });
                }
                const normalizedPhone = lalamoveService.normalizePhone(trimmedPhone);
                if (!lalamoveService.isValidPhone(normalizedPhone)) {
                    return res.status(400).json({ error: 'Invalid phone number format. Use E.164, e.g. +60123456789' });
                }
                fields.push('phone = ?');
                values.push(normalizedPhone);
            }
            if (note !== undefined) {
                fields.push('note = ?');
                values.push(String(note || '').trim().slice(0, 66));
            }
            if (latitude !== undefined || longitude !== undefined) {
                if (latitude === undefined || longitude === undefined) {
                    return res.status(400).json({ error: 'latitude and longitude must be updated together' });
                }
                const lat = toNumber(latitude);
                const lng = toNumber(longitude);
                if (lat === null || lng === null) {
                    return res.status(400).json({ error: 'latitude and longitude must be valid numbers' });
                }
                if (!isValidLatitude(lat) || !isValidLongitude(lng)) {
                    return res.status(400).json({
                        error: 'Invalid coordinates. Latitude must be between -90 and 90, longitude between -180 and 180.'
                    });
                }
                const normalizedLat = roundCoordinate(lat);
                const normalizedLng = roundCoordinate(lng);
                fields.push('latitude = ?');
                values.push(normalizedLat);
                fields.push('longitude = ?');
                values.push(normalizedLng);
            }

            if (fields.length === 0) {
                return res.json({ success: true });
            }

            values.push(addressId, userId);
            await db.query(
                `UPDATE user_addresses SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`,
                values
            );

            return res.json({ success: true });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ error: 'Failed to update address' });
        }
    });

    app.delete('/api/addresses/:id', requireAuth, async (req, res) => {
        try {
            const userId = req.user.id;
            const addressId = toPositiveInteger(req.params.id);
            if (!addressId) {
                return res.status(400).json({ error: 'Invalid address id' });
            }

            await db.query('DELETE FROM user_addresses WHERE id = ? AND user_id = ?', [addressId, userId]);
            return res.json({ success: true });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ error: 'Failed to delete address' });
        }
    });

};
