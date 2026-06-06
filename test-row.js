const mysql = require('mysql2/promise');
async function test() {
  const db = await mysql.createConnection({
    host: '10.0.0.158', user: 'stagefoodiedash', password: '060217', database: 'foodiedash'
  });
  const [rows] = await db.query("SELECT * FROM orders WHERE id=39");
  console.log(rows[0].external_order_id);
  console.log(rows[0].tracking_url);
}
test();
