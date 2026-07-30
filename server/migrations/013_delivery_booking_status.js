const db = require('../db');

module.exports = {
    version: 13,
    description: 'Lalamove delivery booking status fields for dispatch reliability',
    up: async () => {
        await db.query(`
            ALTER TABLE orders
            ADD COLUMN IF NOT EXISTS delivery_booking_status VARCHAR(32) NOT NULL DEFAULT 'not_required',
            ADD COLUMN IF NOT EXISTS delivery_booking_error VARCHAR(500) NULL,
            ADD COLUMN IF NOT EXISTS delivery_booking_attempts INT NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS delivery_last_attempt_at DATETIME NULL
        `);

        // Backfill existing rows
        await db.query(`
            UPDATE orders
            SET delivery_booking_status = CASE
                WHEN order_type = 'Pickup' THEN 'not_required'
                WHEN delivery_provider = 'Lalamove' AND external_order_id IS NOT NULL AND TRIM(external_order_id) <> '' THEN 'booked'
                WHEN order_type = 'Delivery' AND (external_order_id IS NULL OR TRIM(external_order_id) = '') THEN 'booking_failed'
                ELSE 'not_required'
            END
            WHERE 1=1
        `);
    },
    down: async () => {
        await db.query(`
            ALTER TABLE orders
            DROP COLUMN IF EXISTS delivery_booking_status,
            DROP COLUMN IF EXISTS delivery_booking_error,
            DROP COLUMN IF EXISTS delivery_booking_attempts,
            DROP COLUMN IF EXISTS delivery_last_attempt_at
        `);
    }
};
