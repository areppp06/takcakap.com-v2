const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const MIGRATIONS_TABLE = 'schema_migrations';

const ensureMigrationsTable = async (connection) => {
    await connection.query(
        `
            CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
                id BIGINT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(191) NOT NULL,
                checksum CHAR(64) NOT NULL,
                applied_at DATETIME NOT NULL DEFAULT UTC_TIMESTAMP(),
                UNIQUE KEY uniq_schema_migrations_name (name)
            )
        `
    );
};

const listMigrationFiles = () => {
    if (!fs.existsSync(MIGRATIONS_DIR)) return [];
    return fs
        .readdirSync(MIGRATIONS_DIR)
        .filter((file) => /\.js$/i.test(file) && /^\d+[_-].+\.js$/i.test(file))
        .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
};

const fileChecksum = (absolutePath) => {
    const source = fs.readFileSync(absolutePath);
    return crypto.createHash('sha256').update(source).digest('hex');
};

const loadMigrationModule = (absolutePath) => {
    // Force refresh during repeated local runs.
    delete require.cache[require.resolve(absolutePath)];
    const migration = require(absolutePath);
    if (!migration || typeof migration.up !== 'function') {
        throw new Error(`Migration ${path.basename(absolutePath)} must export an 'up' function`);
    }
    return migration;
};

const getAppliedMigrations = async (connection) => {
    await ensureMigrationsTable(connection);
    const [rows] = await connection.query(
        `
            SELECT name, checksum
            FROM ${MIGRATIONS_TABLE}
            ORDER BY id ASC
        `
    );
    const map = new Map();
    for (const row of rows) {
        map.set(String(row.name), String(row.checksum));
    }
    return map;
};

const getPendingMigrations = async () => {
    const files = listMigrationFiles();
    const connection = await db.getConnection();
    try {
        const applied = await getAppliedMigrations(connection);
        const pending = [];
        for (const fileName of files) {
            const absolutePath = path.join(MIGRATIONS_DIR, fileName);
            const checksum = fileChecksum(absolutePath);
            const appliedChecksum = applied.get(fileName);
            if (!appliedChecksum) {
                pending.push({ fileName, absolutePath, checksum });
                continue;
            }
            if (appliedChecksum !== checksum) {
                throw new Error(
                    `Migration checksum mismatch for ${fileName}. Expected ${appliedChecksum}, got ${checksum}.` +
                        ' Create a new migration instead of editing an applied file.'
                );
            }
        }
        return pending;
    } finally {
        connection.release();
    }
};

const runMigrations = async ({ logger = console } = {}) => {
    const files = listMigrationFiles();
    if (files.length === 0) {
        logger.info?.('[migrations] No migration files found.');
        return { applied: [] };
    }

    const connection = await db.getConnection();
    const appliedFiles = [];
    try {
        const applied = await getAppliedMigrations(connection);

        for (const fileName of files) {
            const absolutePath = path.join(MIGRATIONS_DIR, fileName);
            const checksum = fileChecksum(absolutePath);
            const appliedChecksum = applied.get(fileName);

            if (appliedChecksum) {
                if (appliedChecksum !== checksum) {
                    throw new Error(
                        `Migration checksum mismatch for ${fileName}. Expected ${appliedChecksum}, got ${checksum}.`
                    );
                }
                continue;
            }

            logger.info?.(`[migrations] Applying ${fileName}...`);
            const migration = loadMigrationModule(absolutePath);
            await migration.up({ db, connection, logger });
            await connection.query(
                `INSERT INTO ${MIGRATIONS_TABLE} (name, checksum, applied_at) VALUES (?, ?, UTC_TIMESTAMP())`,
                [fileName, checksum]
            );
            appliedFiles.push(fileName);
            logger.info?.(`[migrations] Applied ${fileName}`);
        }

        return { applied: appliedFiles };
    } finally {
        connection.release();
    }
};

const assertNoPendingMigrations = async () => {
    const pending = await getPendingMigrations();
    if (!pending.length) return;
    const names = pending.map((entry) => entry.fileName).join(', ');
    const error = new Error(`Pending migrations detected: ${names}. Run 'npm run db:migrate' before starting the server.`);
    error.status = 500;
    throw error;
};

module.exports = {
    runMigrations,
    getPendingMigrations,
    assertNoPendingMigrations
};
