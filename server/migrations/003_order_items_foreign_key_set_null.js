module.exports.up = async ({ connection, logger = console }) => {
    logger.info?.('[migrations] Adjusting order_items foreign key constraint...');

    // Check if fk_order_items_menu_item already exists to ensure idempotency
    const [existingNew] = await connection.query(`
        SELECT CONSTRAINT_NAME 
        FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE 
        WHERE TABLE_SCHEMA = DATABASE() 
          AND TABLE_NAME = 'order_items' 
          AND CONSTRAINT_NAME = 'fk_order_items_menu_item'
        LIMIT 1
    `);

    if (existingNew.length > 0) {
        logger.info?.('[migrations] Constraint fk_order_items_menu_item already exists. Nothing to do.');
        return;
    }

    // 1. Find the existing foreign key constraint name referencing menu_items(id)
    const [rows] = await connection.query(`
        SELECT CONSTRAINT_NAME 
        FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE 
        WHERE TABLE_SCHEMA = DATABASE() 
          AND TABLE_NAME = 'order_items' 
          AND COLUMN_NAME = 'menu_item_id' 
          AND REFERENCED_TABLE_NAME = 'menu_items'
        LIMIT 1
    `);

    if (rows.length > 0) {
        const constraintName = rows[0].CONSTRAINT_NAME;
        logger.info?.(`[migrations] Dropping foreign key constraint: ${constraintName}`);
        await connection.query(`ALTER TABLE order_items DROP FOREIGN KEY \`${constraintName}\``);
    } else {
        logger.info?.('[migrations] No existing constraint found referencing menu_items(id)');
    }

    // 2. Add the new constraint with ON DELETE SET NULL
    logger.info?.('[migrations] Adding new constraint fk_order_items_menu_item on order_items');
    await connection.query(`
        ALTER TABLE order_items 
        ADD CONSTRAINT fk_order_items_menu_item 
        FOREIGN KEY (menu_item_id) REFERENCES menu_items(id) 
        ON DELETE SET NULL
    `);

    logger.info?.('[migrations] Foreign key adjustment completed successfully');
};
