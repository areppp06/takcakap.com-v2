const db = require('../db');

const incrementPrefix = (prefix) => {
    const chars = prefix.split('');
    for (let i = chars.length - 1; i >= 0; i--) {
        const charCode = chars[i].charCodeAt(0);
        if (charCode < 90) { // 'Z' is 90
            chars[i] = String.fromCharCode(charCode + 1);
            break;
        } else {
            chars[i] = 'A';
        }
    }
    return chars.join('');
};

const getNextOrderCode = (lastCode) => {
    if (!lastCode) return 'AAA-001';
    const parts = lastCode.split('-');
    let prefix = parts[0];
    let num = parseInt(parts[1], 10);

    num += 1;
    if (num > 999) {
        num = 1;
        prefix = incrementPrefix(prefix);
    }
    
    const paddedNum = String(num).padStart(3, '0');
    return `${prefix}-${paddedNum}`;
};

async function up() {
    // 1. Add short_code column if not exists
    await db.query(`
        ALTER TABLE orders 
        ADD COLUMN IF NOT EXISTS short_code VARCHAR(16) NULL
    `);

    // 2. Backfill existing orders
    const [orders] = await db.query(`
        SELECT id FROM orders 
        WHERE short_code IS NULL 
        ORDER BY id ASC
    `);

    if (orders.length > 0) {
        // Fetch the last short_code in the DB to continue from it (if any)
        const [lastOrder] = await db.query(`
            SELECT short_code FROM orders 
            WHERE short_code IS NOT NULL 
            ORDER BY id DESC LIMIT 1
        `);
        let currentCode = lastOrder[0]?.short_code || null;

        for (const order of orders) {
            currentCode = getNextOrderCode(currentCode);
            await db.query(
                `UPDATE orders SET short_code = ? WHERE id = ?`,
                [currentCode, order.id]
            );
        }
    }

    // 3. Add UNIQUE constraint to short_code
    await db.query(`
        ALTER TABLE orders
        ADD UNIQUE KEY IF NOT EXISTS uq_short_code (short_code)
    `);

    console.log('Migration 005_add_short_code_to_orders up executed successfully.');
}

async function down() {
    await db.query(`
        ALTER TABLE orders
        DROP KEY IF EXISTS uq_short_code,
        DROP COLUMN IF EXISTS short_code;
    `);
    console.log('Migration 005_add_short_code_to_orders down executed successfully.');
}

module.exports = { up, down };
