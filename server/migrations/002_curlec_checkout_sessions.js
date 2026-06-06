const ensureIndex = async (connection, sql) => {
    try {
        await connection.query(sql);
    } catch (error) {
        const duplicateKeyName =
            error?.code === 'ER_DUP_KEYNAME' ||
            error?.errno === 1061 ||
            /duplicate key name/i.test(String(error?.message || ''));
        if (!duplicateKeyName) {
            throw error;
        }
    }
};

module.exports.up = async ({ connection, logger = console }) => {
    logger.info?.('[migrations] Applying Curlec checkout session schema...');

    await connection.query(`
        CREATE TABLE IF NOT EXISTS curlec_checkout_sessions (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            session_id VARCHAR(80) NOT NULL,
            user_id INT NOT NULL,
            curlec_order_id VARCHAR(64) NOT NULL,
            expected_amount_minor INT NOT NULL,
            currency VARCHAR(8) NOT NULL DEFAULT 'MYR',
            order_payload_json JSON NULL,
            status ENUM('created', 'consumed', 'captured_no_order', 'capture_reconciled', 'capture_failed') NOT NULL DEFAULT 'created',
            consumed_order_id INT NULL,
            consumed_at DATETIME NULL,
            payment_id VARCHAR(64) NULL,
            payment_captured_at DATETIME NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_curlec_checkout_session_id (session_id),
            UNIQUE KEY uniq_curlec_checkout_order_id (curlec_order_id),
            KEY idx_curlec_checkout_user_created (user_id, created_at),
            KEY idx_curlec_checkout_payment_id (payment_id)
        )
    `);

    await connection.query(`
        ALTER TABLE curlec_checkout_sessions
        ADD COLUMN IF NOT EXISTS session_id VARCHAR(80) NOT NULL,
        ADD COLUMN IF NOT EXISTS user_id INT NOT NULL,
        ADD COLUMN IF NOT EXISTS curlec_order_id VARCHAR(64) NOT NULL,
        ADD COLUMN IF NOT EXISTS expected_amount_minor INT NOT NULL,
        ADD COLUMN IF NOT EXISTS currency VARCHAR(8) NOT NULL DEFAULT 'MYR',
        ADD COLUMN IF NOT EXISTS order_payload_json JSON NULL,
        ADD COLUMN IF NOT EXISTS status ENUM('created', 'consumed', 'captured_no_order', 'capture_reconciled', 'capture_failed') NOT NULL DEFAULT 'created',
        ADD COLUMN IF NOT EXISTS consumed_order_id INT NULL,
        ADD COLUMN IF NOT EXISTS consumed_at DATETIME NULL,
        ADD COLUMN IF NOT EXISTS payment_id VARCHAR(64) NULL,
        ADD COLUMN IF NOT EXISTS payment_captured_at DATETIME NULL,
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    `);

    await ensureIndex(connection, 'CREATE UNIQUE INDEX uniq_curlec_checkout_session_id ON curlec_checkout_sessions (session_id)');
    await ensureIndex(connection, 'CREATE UNIQUE INDEX uniq_curlec_checkout_order_id ON curlec_checkout_sessions (curlec_order_id)');
    await ensureIndex(connection, 'CREATE INDEX idx_curlec_checkout_user_created ON curlec_checkout_sessions (user_id, created_at)');
    await ensureIndex(connection, 'CREATE INDEX idx_curlec_checkout_payment_id ON curlec_checkout_sessions (payment_id)');

    logger.info?.('[migrations] Curlec checkout session schema ready');
};
