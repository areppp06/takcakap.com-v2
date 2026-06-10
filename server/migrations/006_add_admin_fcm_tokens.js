const db = require('../db');

module.exports = {
    version: 6,
    description: 'Add admin_fcm_tokens table for Android wrapper notifications',
    up: async () => {
        await db.query(`
            CREATE TABLE IF NOT EXISTS admin_fcm_tokens (
                token VARCHAR(255) PRIMARY KEY,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);
    },
    down: async () => {
        await db.query('DROP TABLE IF EXISTS admin_fcm_tokens');
    }
};
