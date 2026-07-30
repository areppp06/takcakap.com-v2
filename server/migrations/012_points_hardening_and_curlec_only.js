const db = require('../db');

const ensureIndex = async (sql) => {
    try {
        await db.query(sql);
    } catch (error) {
        const duplicate =
            error?.code === 'ER_DUP_KEYNAME' ||
            error?.errno === 1061 ||
            /duplicate key name/i.test(String(error?.message || ''));
        if (!duplicate) throw error;
    }
};

module.exports = {
    version: 12,
    description: 'Points ledger uniqueness, refund restore flags, stock restore, Curlec-only payment defaults',
    up: async () => {
        // Curlec-only product path: keep columns for history but force flags
        await db.query(`
            UPDATE payment_options
            SET duitnow_enabled = FALSE,
                curlec_enabled = TRUE
            WHERE id = 1
        `);

        await db.query(`
            ALTER TABLE orders
            ADD COLUMN IF NOT EXISTS stock_restored_at DATETIME NULL,
            ADD COLUMN IF NOT EXISTS voucher_restored_at DATETIME NULL,
            ADD COLUMN IF NOT EXISTS points_clawed_back_at DATETIME NULL
        `);

        // Remove duplicate earn rows keeping the lowest id per (type, reference)
        await db.query(`
            DELETE t1 FROM points_transactions t1
            INNER JOIN points_transactions t2
              ON t1.transaction_type = t2.transaction_type
             AND t1.reference_id = t2.reference_id
             AND t1.id > t2.id
            WHERE t1.reference_id IS NOT NULL
              AND t1.transaction_type IN ('earned', 'cancelled_order')
        `);

        await ensureIndex(`
            CREATE UNIQUE INDEX uniq_points_txn_type_ref
            ON points_transactions (transaction_type, reference_id)
        `);

        await ensureIndex(`
            CREATE INDEX idx_points_transactions_user_created
            ON points_transactions (user_id, created_at)
        `);
    },
    down: async () => {
        try {
            await db.query('DROP INDEX uniq_points_txn_type_ref ON points_transactions');
        } catch (_) {
            /* ignore */
        }
        try {
            await db.query('DROP INDEX idx_points_transactions_user_created ON points_transactions');
        } catch (_) {
            /* ignore */
        }
        await db.query(`
            ALTER TABLE orders
            DROP COLUMN IF EXISTS stock_restored_at,
            DROP COLUMN IF EXISTS voucher_restored_at,
            DROP COLUMN IF EXISTS points_clawed_back_at
        `);
    }
};
