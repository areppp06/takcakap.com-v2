require('dotenv').config();
const { runMigrations } = require('./migrationRunner');

(async () => {
    try {
        const result = await runMigrations({ logger: console });
        if (!result.applied.length) {
            console.log('[migrations] Already up to date');
        }
        process.exit(0);
    } catch (error) {
        console.error('[migrations] Failed:', error?.message || error);
        process.exit(1);
    }
})();
