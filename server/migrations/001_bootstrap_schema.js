const bcrypt = require('bcryptjs');
const lalamoveService = require('../lalamoveService');

const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || 'admin@takcakap.com').trim().toLowerCase();
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || '').trim();
const ADMIN_NAME = String(process.env.ADMIN_NAME || 'TakCakap Admin').trim();
const DEFAULT_DUITNOW_QR_URL = String(
    process.env.DUITNOW_QR_URL ||
        'https://res.cloudinary.com/dzayh29d7/image/upload/v1770301357/KC_QR_vljdez.png'
).trim();
const parsedDefaultServiceFee = Number.parseFloat(String(process.env.DEFAULT_SERVICE_FEE ?? '1.8'));
const DEFAULT_SERVICE_FEE = Math.max(0, Number.isFinite(parsedDefaultServiceFee) ? parsedDefaultServiceFee : 1.8);
const DEFAULT_SHOP_OPEN_TIME = String(process.env.SHOP_OPEN_TIME || '09:00').trim();
const DEFAULT_SHOP_CLOSE_TIME = String(process.env.SHOP_CLOSE_TIME || '22:00').trim();
const DEFAULT_STORE_NAME = 'TakCakap KL Sentral';
const DEFAULT_STORE_PHONE = '+60123456789';
const DEFAULT_STORE_ADDRESS = 'Jalan Stesen Sentral 5, Kuala Lumpur, 50470, Malaysia';
const DEFAULT_STORE_LATITUDE = 3.1347;
const DEFAULT_STORE_LONGITUDE = 101.6869;

const HH_MM_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const isValidHHMM = (value) => HH_MM_PATTERN.test(String(value || '').trim());

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

const assertNoDuplicateColumnValues = async (connection, { table, column, whereClause = '1=1' }) => {
    const [rows] = await connection.query(
        `
            SELECT ${column} AS duplicate_value, COUNT(*) AS duplicate_count
            FROM ${table}
            WHERE ${whereClause}
            GROUP BY ${column}
            HAVING COUNT(*) > 1
            LIMIT 5
        `
    );
    if (!rows.length) return;
    const details = rows
        .map((row) => `${row.duplicate_value} (x${row.duplicate_count})`)
        .join(', ');
    throw new Error(`Cannot enforce unique index on ${table}.${column}; duplicate values detected: ${details}`);
};

module.exports.up = async ({ connection, logger = console }) => {
    let ownedConnection = null;
    try {
        if (!connection) {
            const db = require('../db');
            ownedConnection = await db.getConnection();
            connection = ownedConnection;
        }

        logger.info?.('[migrations] Bootstrap schema migration running...');

        await connection.query(`
            CREATE TABLE IF NOT EXISTS users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                email VARCHAR(100) UNIQUE NOT NULL,
                google_id VARCHAR(128),
                password_hash VARCHAR(255) DEFAULT '',
                role ENUM('user', 'admin') DEFAULT 'user',
                phone_number VARCHAR(32),
                is_suspended TINYINT(1) NOT NULL DEFAULT 0,
                suspended_at DATETIME NULL,
                avatar_url VARCHAR(255),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await connection.query(`
            ALTER TABLE users
            ADD COLUMN IF NOT EXISTS google_id VARCHAR(128),
            ADD COLUMN IF NOT EXISTS phone_number VARCHAR(32),
            ADD COLUMN IF NOT EXISTS is_suspended TINYINT(1) NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS suspended_at DATETIME NULL
        `);

        const [existingAdminRows] = await connection.query(
            'SELECT id FROM users WHERE email = ? LIMIT 1',
            [ADMIN_EMAIL]
        );
        if (existingAdminRows.length === 0) {
            const hash = ADMIN_PASSWORD ? await bcrypt.hash(ADMIN_PASSWORD, 10) : '';
            await connection.query(
                `
                    INSERT INTO users (name, email, password_hash, role, avatar_url)
                    VALUES (?, ?, ?, 'admin', NULL)
                `,
                [ADMIN_NAME, ADMIN_EMAIL, hash]
            );
        }

        await connection.query(`
            CREATE TABLE IF NOT EXISTS categories (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(50) NOT NULL,
                icon VARCHAR(50),
                sort_order INT DEFAULT 0
            )
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS menu_items (
                id INT AUTO_INCREMENT PRIMARY KEY,
                category_id INT,
                name VARCHAR(100) NOT NULL,
                description TEXT,
                price DECIMAL(10, 2) NOT NULL,
                image_url VARCHAR(255),
                stock INT DEFAULT 0,
                is_active BOOLEAN DEFAULT TRUE,
                sort_order INT DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
            )
        `);
        await connection.query(`
            ALTER TABLE menu_items
            ADD COLUMN IF NOT EXISTS sort_order INT DEFAULT 0
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS delivery_options (
                id TINYINT PRIMARY KEY,
                pickup_enabled BOOLEAN NOT NULL DEFAULT TRUE,
                lalamove_enabled BOOLEAN NOT NULL DEFAULT TRUE,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);
        await connection.query(`
            INSERT INTO delivery_options (id, pickup_enabled, lalamove_enabled)
            VALUES (1, TRUE, TRUE)
            ON DUPLICATE KEY UPDATE id = VALUES(id)
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS payment_options (
                id TINYINT PRIMARY KEY,
                duitnow_qr_url TEXT NOT NULL,
                duitnow_enabled BOOLEAN NOT NULL DEFAULT TRUE,
                curlec_enabled BOOLEAN NOT NULL DEFAULT FALSE,
                service_fee DECIMAL(10, 2) NOT NULL DEFAULT 1.80,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);
        await connection.query(`
            ALTER TABLE payment_options
            ADD COLUMN IF NOT EXISTS duitnow_enabled BOOLEAN NOT NULL DEFAULT TRUE,
            ADD COLUMN IF NOT EXISTS curlec_enabled BOOLEAN NOT NULL DEFAULT FALSE,
            ADD COLUMN IF NOT EXISTS service_fee DECIMAL(10, 2) NOT NULL DEFAULT 1.80
        `);
        await connection.query(
            `
                INSERT INTO payment_options (id, duitnow_qr_url, duitnow_enabled, curlec_enabled, service_fee)
                VALUES (1, ?, TRUE, FALSE, ?)
                ON DUPLICATE KEY UPDATE id = VALUES(id)
            `,
            [DEFAULT_DUITNOW_QR_URL, Number(DEFAULT_SERVICE_FEE.toFixed(2))]
        );

        await connection.query(`
            CREATE TABLE IF NOT EXISTS shop_settings (
                id TINYINT PRIMARY KEY,
                open_time CHAR(5) NOT NULL DEFAULT '09:00',
                close_time CHAR(5) NOT NULL DEFAULT '22:00',
                pause_orders BOOLEAN NOT NULL DEFAULT FALSE,
                store_name VARCHAR(120) NOT NULL DEFAULT 'TakCakap KL Sentral',
                store_phone VARCHAR(32) NOT NULL DEFAULT '+60123456789',
                store_address VARCHAR(255) NOT NULL DEFAULT 'Jalan Stesen Sentral 5, Kuala Lumpur, 50470, Malaysia',
                store_latitude DECIMAL(10, 7) NOT NULL DEFAULT 3.1347000,
                store_longitude DECIMAL(10, 7) NOT NULL DEFAULT 101.6869000,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);
        await connection.query(`
            ALTER TABLE shop_settings
            ADD COLUMN IF NOT EXISTS store_name VARCHAR(120) NOT NULL DEFAULT 'TakCakap KL Sentral',
            ADD COLUMN IF NOT EXISTS store_phone VARCHAR(32) NOT NULL DEFAULT '+60123456789',
            ADD COLUMN IF NOT EXISTS store_address VARCHAR(255) NOT NULL DEFAULT 'Jalan Stesen Sentral 5, Kuala Lumpur, 50470, Malaysia',
            ADD COLUMN IF NOT EXISTS store_latitude DECIMAL(10, 7) NOT NULL DEFAULT 3.1347000,
            ADD COLUMN IF NOT EXISTS store_longitude DECIMAL(10, 7) NOT NULL DEFAULT 101.6869000
        `);
        await connection.query(
            `
                INSERT INTO shop_settings (
                    id,
                    open_time,
                    close_time,
                    pause_orders,
                    store_name,
                    store_phone,
                    store_address,
                    store_latitude,
                    store_longitude
                )
                VALUES (?, ?, ?, FALSE, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE id = VALUES(id)
            `,
            [
                1,
                isValidHHMM(DEFAULT_SHOP_OPEN_TIME) ? DEFAULT_SHOP_OPEN_TIME : '09:00',
                isValidHHMM(DEFAULT_SHOP_CLOSE_TIME) ? DEFAULT_SHOP_CLOSE_TIME : '22:00',
                DEFAULT_STORE_NAME,
                lalamoveService.normalizePhone(DEFAULT_STORE_PHONE) || '+60123456789',
                DEFAULT_STORE_ADDRESS,
                DEFAULT_STORE_LATITUDE,
                DEFAULT_STORE_LONGITUDE
            ]
        );

        await connection.query(`
            CREATE TABLE IF NOT EXISTS orders (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT,
                status VARCHAR(50) DEFAULT 'Pending Payment',
                order_type ENUM('Pickup', 'Delivery') DEFAULT 'Delivery',
                total_amount DECIMAL(10, 2) NOT NULL,
                delivery_address TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
            )
        `);

        await connection.query(`
            ALTER TABLE orders
            ADD COLUMN IF NOT EXISTS delivery_provider ENUM('Internal', 'Lalamove') DEFAULT 'Internal',
            ADD COLUMN IF NOT EXISTS external_order_id VARCHAR(32),
            ADD COLUMN IF NOT EXISTS quotation_id VARCHAR(32),
            ADD COLUMN IF NOT EXISTS tracking_url TEXT,
            ADD COLUMN IF NOT EXISTS driver_id VARCHAR(32),
            ADD COLUMN IF NOT EXISTS lalamove_status VARCHAR(50),
            ADD COLUMN IF NOT EXISTS payment_method VARCHAR(32) DEFAULT 'DuitNow',
            ADD COLUMN IF NOT EXISTS curlec_order_id VARCHAR(64) NULL,
            ADD COLUMN IF NOT EXISTS curlec_payment_id VARCHAR(64) NULL,
            ADD COLUMN IF NOT EXISTS delivery_fee DECIMAL(10, 2),
            ADD COLUMN IF NOT EXISTS delivery_currency VARCHAR(8),
            ADD COLUMN IF NOT EXISTS quotation_expires_at DATETIME,
            ADD COLUMN IF NOT EXISTS delivery_timing ENUM('NOW', 'SCHEDULED') NOT NULL DEFAULT 'NOW',
            ADD COLUMN IF NOT EXISTS scheduled_at_utc DATETIME NULL,
            ADD COLUMN IF NOT EXISTS lalamove_ongoing_at DATETIME NULL,
            ADD COLUMN IF NOT EXISTS delivery_contact_phone VARCHAR(32) NULL,
            ADD COLUMN IF NOT EXISTS delivery_label_snapshot VARCHAR(100) NULL,
            ADD COLUMN IF NOT EXISTS delivery_note_snapshot TEXT NULL,
            ADD COLUMN IF NOT EXISTS delivery_latitude DECIMAL(10, 7) NULL,
            ADD COLUMN IF NOT EXISTS delivery_longitude DECIMAL(10, 7) NULL,
            ADD COLUMN IF NOT EXISTS recipient_name_snapshot VARCHAR(191) NULL,
            ADD COLUMN IF NOT EXISTS payment_success_email_sent_at DATETIME NULL,
            ADD COLUMN IF NOT EXISTS order_completed_email_sent_at DATETIME NULL,
            ADD COLUMN IF NOT EXISTS order_cancelled_email_sent_at DATETIME NULL,
            ADD COLUMN IF NOT EXISTS refund_status VARCHAR(24) NULL,
            ADD COLUMN IF NOT EXISTS refund_amount DECIMAL(10, 2) NULL,
            ADD COLUMN IF NOT EXISTS refund_id VARCHAR(64) NULL,
            ADD COLUMN IF NOT EXISTS refund_speed_requested VARCHAR(32) NULL,
            ADD COLUMN IF NOT EXISTS refund_speed_processed VARCHAR(32) NULL,
            ADD COLUMN IF NOT EXISTS refund_requested_at DATETIME NULL,
            ADD COLUMN IF NOT EXISTS refund_processed_at DATETIME NULL,
            ADD COLUMN IF NOT EXISTS refund_failed_at DATETIME NULL,
            ADD COLUMN IF NOT EXISTS refund_failure_reason VARCHAR(500) NULL,
            ADD COLUMN IF NOT EXISTS refund_reason VARCHAR(255) NULL,
            ADD COLUMN IF NOT EXISTS refund_idempotency_key VARCHAR(128) NULL,
            ADD COLUMN IF NOT EXISTS refund_initiated_by_user_id INT NULL,
            ADD COLUMN IF NOT EXISTS refund_initiated_email_sent_at DATETIME NULL,
            ADD COLUMN IF NOT EXISTS stock_deducted_at DATETIME NULL,
            ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS order_items (
                id INT AUTO_INCREMENT PRIMARY KEY,
                order_id INT,
                menu_item_id INT,
                item_name_snapshot VARCHAR(191),
                quantity INT NOT NULL,
                unit_price DECIMAL(10, 2) NOT NULL,
                FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
                FOREIGN KEY (menu_item_id) REFERENCES menu_items(id)
            )
        `);
        await connection.query(`
            ALTER TABLE order_items
            ADD COLUMN IF NOT EXISTS item_name_snapshot VARCHAR(191)
        `);

        await ensureIndex(connection, 'CREATE INDEX idx_orders_created_id ON orders (created_at, id)');
        await ensureIndex(connection, 'CREATE INDEX idx_orders_updated_id ON orders (updated_at, id)');
        await ensureIndex(connection, 'CREATE INDEX idx_orders_status_created_id ON orders (status, created_at, id)');
        await ensureIndex(connection, 'CREATE INDEX idx_orders_refund_status_created_id ON orders (refund_status, created_at, id)');
        await ensureIndex(connection, 'CREATE INDEX idx_orders_timing_created_id ON orders (delivery_timing, created_at, id)');
        await ensureIndex(connection, 'CREATE INDEX idx_orders_user_created_id ON orders (user_id, created_at, id)');
        await ensureIndex(connection, 'CREATE INDEX idx_orders_payment_method_created_id ON orders (payment_method, created_at, id)');
        await ensureIndex(connection, 'CREATE INDEX idx_orders_external_order_id ON orders (external_order_id)');
        await ensureIndex(connection, 'CREATE INDEX idx_order_items_order_id ON order_items (order_id)');

        await connection.query(`
            CREATE TABLE IF NOT EXISTS user_addresses (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                name VARCHAR(100) NOT NULL,
                address_line TEXT NOT NULL,
                phone VARCHAR(32) NOT NULL DEFAULT '',
                note TEXT,
                latitude DECIMAL(10, 7),
                longitude DECIMAL(10, 7),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);
        await connection.query(`
            ALTER TABLE user_addresses
            ADD COLUMN IF NOT EXISTS phone VARCHAR(32) NOT NULL DEFAULT ''
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS cart_items (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                menu_item_id INT NOT NULL,
                quantity INT NOT NULL DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY uniq_user_menu (user_id, menu_item_id),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (menu_item_id) REFERENCES menu_items(id) ON DELETE CASCADE
            )
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS delivery_quotes (
                id BIGINT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                quotation_id VARCHAR(64) NOT NULL,
                fee DECIMAL(10, 2) NOT NULL DEFAULT 0,
                currency VARCHAR(8) NOT NULL DEFAULT 'MYR',
                expires_at DATETIME NULL,
                scheduled_at_utc DATETIME NULL,
                sender_stop_id VARCHAR(64) NULL,
                recipient_stop_id VARCHAR(64) NULL,
                metadata_json JSON NULL,
                used_at DATETIME NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY uniq_delivery_quote_id (quotation_id),
                KEY idx_delivery_quotes_user_created (user_id, created_at),
                KEY idx_delivery_quotes_used (used_at)
            )
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS webhook_events (
                id BIGINT AUTO_INCREMENT PRIMARY KEY,
                provider VARCHAR(32) NOT NULL,
                event_id VARCHAR(191) NOT NULL,
                payload_hash CHAR(64) NOT NULL,
                status ENUM('processing', 'processed', 'failed') NOT NULL DEFAULT 'processing',
                processed_at DATETIME NULL,
                last_error VARCHAR(500) NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY uniq_webhook_provider_event (provider, event_id),
                KEY idx_webhook_status_updated (status, updated_at)
            )
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS email_outbox (
                id BIGINT AUTO_INCREMENT PRIMARY KEY,
                order_id INT NOT NULL,
                event_type VARCHAR(40) NOT NULL,
                status ENUM('pending', 'processing', 'failed', 'failed_permanent', 'sent') NOT NULL DEFAULT 'pending',
                attempt_count INT NOT NULL DEFAULT 0,
                next_attempt_at DATETIME NULL,
                locked_at DATETIME NULL,
                sent_at DATETIME NULL,
                last_error VARCHAR(500) NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY uniq_email_outbox_order_event (order_id, event_type),
                KEY idx_email_outbox_status_next_attempt (status, next_attempt_at, id)
            )
        `);

        await assertNoDuplicateColumnValues(connection, {
            table: 'orders',
            column: 'curlec_payment_id',
            whereClause: "curlec_payment_id IS NOT NULL AND TRIM(curlec_payment_id) <> ''"
        });
        await assertNoDuplicateColumnValues(connection, {
            table: 'orders',
            column: 'external_order_id',
            whereClause: "external_order_id IS NOT NULL AND TRIM(external_order_id) <> ''"
        });
        await ensureIndex(connection, 'CREATE UNIQUE INDEX uniq_orders_curlec_payment_id ON orders (curlec_payment_id)');
        await ensureIndex(connection, 'CREATE UNIQUE INDEX uniq_orders_external_order_id ON orders (external_order_id)');

        logger.info?.('[migrations] Bootstrap schema migration completed');
    } finally {
        if (ownedConnection) {
            ownedConnection.release();
        }
    }
};
