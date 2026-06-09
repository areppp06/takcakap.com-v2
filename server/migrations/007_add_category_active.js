const db = require('../db');

module.exports = {
    version: 7,
    description: 'Add is_active column to categories table',
    up: async () => {
        await db.query(`
            ALTER TABLE categories 
            ADD COLUMN is_active BOOLEAN DEFAULT TRUE
        `);
    },
    down: async () => {
        await db.query(`
            ALTER TABLE categories 
            DROP COLUMN is_active
        `);
    }
};
