const db = require('../db');

async function up() {
    await db.query(`
        CREATE TABLE IF NOT EXISTS push_subscriptions (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            endpoint TEXT NOT NULL,
            p256dh TEXT NOT NULL,
            auth VARCHAR(255) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            UNIQUE KEY unique_endpoint (endpoint(255))
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('Migration 004_push_subscriptions up executed successfully.');
}

async function down() {
    await db.query(`DROP TABLE IF EXISTS push_subscriptions;`);
    console.log('Migration 004_push_subscriptions down executed successfully.');
}

module.exports = { up, down };
