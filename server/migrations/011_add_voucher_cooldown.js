const db = require('../db');

module.exports = {
    version: 11,
    description: 'Add voucher cooldown to shop settings',
    up: async () => {
        await db.query(`
            ALTER TABLE shop_settings 
            ADD COLUMN IF NOT EXISTS voucher_cooldown_hours INT NOT NULL DEFAULT 12
        `);
    },
    down: async () => {
        await db.query(`
            ALTER TABLE shop_settings 
            DROP COLUMN IF EXISTS voucher_cooldown_hours
        `);
    }
};
