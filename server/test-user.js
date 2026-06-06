const mysql = require('mysql2/promise');
async function test() {
  const db = await mysql.createConnection({
    host: '10.0.0.158', user: 'stagefoodiedash', password: '060217', database: 'foodiedash'
  });
  const [rows] = await db.query("SELECT user_id FROM orders WHERE id=39");
  const userId = rows[0].user_id;
  const [users] = await db.query("SELECT token FROM users WHERE id=?", [userId]);
  console.log("TOKEN:", users[0]?.token);
  await db.end();
}
test().catch(console.error);
