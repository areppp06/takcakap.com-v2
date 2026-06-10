const db = require('./server/db');
const webpush = require('web-push');

const publicVapidKey = process.env.VAPID_PUBLIC_KEY;
const privateVapidKey = process.env.VAPID_PRIVATE_KEY;

if (!publicVapidKey || !privateVapidKey) {
  console.error('VAPID keys not set');
  process.exit(1);
}

webpush.setVapidDetails(
  'mailto:support@takcakap.com',
  publicVapidKey,
  privateVapidKey
);

async function run() {
  const [subs] = await db.query('SELECT * FROM push_subscriptions WHERE user_id = 2');
  console.log('Subscriptions count:', subs.length);
  for (const sub of subs) {
    const pushSubscription = {
      endpoint: sub.endpoint,
      keys: {
        p256dh: sub.p256dh,
        auth: sub.auth
      }
    };
    const payload = JSON.stringify({
      title: 'Simulation Test Push 📢',
      body: 'This is a test notification from the simulation runner.',
      url: '/orders'
    });
    try {
      console.log('Sending to sub ID:', sub.id);
      const res = await webpush.sendNotification(pushSubscription, payload);
      console.log('Send success! Status code:', res.statusCode);
    } catch (err) {
      console.error('Send failed! Status code:', err.statusCode, 'Body:', err.body, 'Message:', err.message);
    }
  }
  db.end(); // Close the database pool so node exits cleanly
  process.exit(0);
}
run().catch(err => {
  console.error(err);
  process.exit(1);
});
