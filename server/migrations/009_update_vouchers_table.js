const db = require('../db');

module.exports = {
    version: 9,
    description: 'Add max_uses, times_used, source, and is_archived to vouchers table',
    up: async () => {
        // Add new columns to vouchers table
        await db.query(`
            ALTER TABLE vouchers 
            ADD COLUMN IF NOT EXISTS max_uses INT DEFAULT 1,
            ADD COLUMN IF NOT EXISTS times_used INT DEFAULT 0,
            ADD COLUMN IF NOT EXISTS source ENUM('points_redemption', 'manual') DEFAULT 'manual',
            ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT FALSE
        `);
    },
    down: async () => {
        await db.query(`
            ALTER TABLE vouchers 
            DROP COLUMN IF EXISTS max_uses,
            DROP COLUMN IF EXISTS times_used,
            DROP COLUMN IF EXISTS source,
            DROP COLUMN IF EXISTS is_archived
        `);
    }
};
