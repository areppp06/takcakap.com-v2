const db = require('../db');

async function columnExists(table, column) {
    const [rows] = await db.query(
        `SELECT 1 AS ok
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = ?
           AND COLUMN_NAME = ?
         LIMIT 1`,
        [table, column]
    );
    return rows.length > 0;
}

async function indexExists(table, indexName) {
    const [rows] = await db.query(
        `SELECT 1 AS ok
         FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = ?
           AND INDEX_NAME = ?
         LIMIT 1`,
        [table, indexName]
    );
    return rows.length > 0;
}

module.exports = {
    version: 14,
    description: 'Harden admin_fcm_tokens: longer token, user_id, device_info',
    up: async () => {
        await db.query(`
            ALTER TABLE admin_fcm_tokens
            MODIFY COLUMN token VARCHAR(512) NOT NULL
        `);

        if (!(await columnExists('admin_fcm_tokens', 'user_id'))) {
            await db.query(`
                ALTER TABLE admin_fcm_tokens
                ADD COLUMN user_id INT NULL
            `);
        }

        if (!(await columnExists('admin_fcm_tokens', 'device_info'))) {
            await db.query(`
                ALTER TABLE admin_fcm_tokens
                ADD COLUMN device_info VARCHAR(255) NULL
            `);
        }

        if (!(await indexExists('admin_fcm_tokens', 'idx_admin_fcm_tokens_user_id'))) {
            await db.query(`
                CREATE INDEX idx_admin_fcm_tokens_user_id
                ON admin_fcm_tokens (user_id)
            `);
        }
    },
    down: async () => {
        if (await indexExists('admin_fcm_tokens', 'idx_admin_fcm_tokens_user_id')) {
            await db.query('DROP INDEX idx_admin_fcm_tokens_user_id ON admin_fcm_tokens');
        }
        if (await columnExists('admin_fcm_tokens', 'device_info')) {
            await db.query('ALTER TABLE admin_fcm_tokens DROP COLUMN device_info');
        }
        if (await columnExists('admin_fcm_tokens', 'user_id')) {
            await db.query('ALTER TABLE admin_fcm_tokens DROP COLUMN user_id');
        }
        await db.query(`
            ALTER TABLE admin_fcm_tokens
            MODIFY COLUMN token VARCHAR(255) NOT NULL
        `);
    }
};
