const db = require('../db');

module.exports = {
    version: 8,
    description: 'Add loyalty points, points transactions, vouchers and discount columns to orders',
    up: async () => {
        // 1. Add points_balance to users
        await db.query(`
            ALTER TABLE users 
            ADD COLUMN IF NOT EXISTS points_balance INT DEFAULT 0
        `);

        // 2. Create points_transactions table
        await db.query(`
            CREATE TABLE IF NOT EXISTS points_transactions (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                points INT NOT NULL,
                transaction_type ENUM('earned', 'redeemed', 'admin_add', 'admin_deduct', 'cancelled_order') NOT NULL,
                reference_id INT NULL,
                description VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        // 3. Create vouchers table
        await db.query(`
            CREATE TABLE IF NOT EXISTS vouchers (
                id INT AUTO_INCREMENT PRIMARY KEY,
                code VARCHAR(50) UNIQUE NOT NULL,
                type ENUM('fixed', 'percentage') NOT NULL,
                discount_value DECIMAL(10, 2) NOT NULL,
                min_spend DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
                max_discount DECIMAL(10, 2) NULL,
                expires_at DATETIME NOT NULL,
                is_active BOOLEAN DEFAULT TRUE,
                user_id INT NULL,
                is_redeemed BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        // 4. Add voucher columns to orders
        await db.query(`
            ALTER TABLE orders
            ADD COLUMN IF NOT EXISTS voucher_id INT NULL,
            ADD COLUMN IF NOT EXISTS discount_amount DECIMAL(10, 2) DEFAULT 0.00
        `);

        // 5. Add foreign key to orders for voucher_id
        try {
            await db.query(`
                ALTER TABLE orders
                ADD CONSTRAINT fk_orders_voucher_id
                FOREIGN KEY (voucher_id) REFERENCES vouchers(id) ON DELETE SET NULL
            `);
        } catch (error) {
            // Ignore error if foreign key / constraint already exists (errno 1022 or 1061)
            if (error?.errno !== 1022 && error?.errno !== 1061 && !/duplicate/i.test(error?.message)) {
                throw error;
            }
        }
    },
    down: async () => {
        // Dropping foreign key first
        try {
            await db.query(`
                ALTER TABLE orders
                DROP FOREIGN KEY fk_orders_voucher_id
            `);
        } catch (error) {
            // Ignore if key doesn't exist
        }
        
        await db.query(`
            ALTER TABLE orders
            DROP COLUMN IF EXISTS voucher_id,
            DROP COLUMN IF EXISTS discount_amount
        `);

        await db.query('DROP TABLE IF EXISTS vouchers');
        await db.query('DROP TABLE IF EXISTS points_transactions');

        await db.query(`
            ALTER TABLE users
            DROP COLUMN IF EXISTS points_balance
        `);
    }
};
