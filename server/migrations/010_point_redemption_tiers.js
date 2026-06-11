const db = require('../db');

module.exports = {
    version: 10,
    description: 'Add point_redemption_tiers table',
    up: async () => {
        await db.query(`
            CREATE TABLE IF NOT EXISTS point_redemption_tiers (
                id INT AUTO_INCREMENT PRIMARY KEY,
                points_required INT NOT NULL,
                discount_amount DECIMAL(10,2) NOT NULL,
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Seed initial data
        const [existing] = await db.query(`SELECT COUNT(*) as cnt FROM point_redemption_tiers`);
        if (existing[0].cnt === 0) {
            await db.query(`
                INSERT INTO point_redemption_tiers (points_required, discount_amount, is_active)
                VALUES 
                (200, 1.00, TRUE),
                (800, 5.00, TRUE),
                (1480, 10.00, TRUE)
            `);
        }
    },
    down: async () => {
        await db.query(`DROP TABLE IF EXISTS point_redemption_tiers`);
    }
};
