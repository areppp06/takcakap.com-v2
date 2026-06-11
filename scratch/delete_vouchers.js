const db = require('../server/db');

async function deleteAllVouchers() {
    try {
        console.log('Archiving all vouchers...');
        const [result] = await db.query('UPDATE vouchers SET is_archived = TRUE');
        console.log(`Successfully archived ${result.affectedRows} vouchers.`);
    } catch (err) {
        console.error('Error archiving vouchers:', err);
    } finally {
        process.exit(0);
    }
}

deleteAllVouchers();
