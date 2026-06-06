require('dotenv').config();
const webpush = require('web-push');
const db = require('./db');

const publicVapidKey = process.env.VAPID_PUBLIC_KEY;
const privateVapidKey = process.env.VAPID_PRIVATE_KEY;
// Use the PUBLIC_APP_URL if defined, otherwise fallback to a default contact email URI
const contactEmail = process.env.ADMIN_EMAIL ? `mailto:${process.env.ADMIN_EMAIL}` : 'mailto:contact@takcakap.com';

if (publicVapidKey && privateVapidKey) {
    webpush.setVapidDetails(
        contactEmail,
        publicVapidKey,
        privateVapidKey
    );
    console.log('✅ Web Push initialized with VAPID keys.');
} else {
    console.warn('⚠️ VAPID keys not found. Web Push notifications will not work.');
}

/**
 * Sends a push notification to all subscribed devices for a specific user.
 * 
 * @param {number} userId - The ID of the user to send the notification to.
 * @param {string} title - Notification title.
 * @param {string} body - Notification body.
 * @param {string} url - Optional URL to open when notification is clicked.
 */
async function sendPushToUser(userId, title, body, url = '/') {
    if (!publicVapidKey || !privateVapidKey) return;

    try {
        const [subscriptions] = await db.query(
            'SELECT * FROM push_subscriptions WHERE user_id = ?',
            [userId]
        );

        if (subscriptions.length === 0) return;

        const payload = JSON.stringify({
            title,
            body,
            url
        });

        const sendPromises = subscriptions.map(async (sub) => {
            const pushSubscription = {
                endpoint: sub.endpoint,
                keys: {
                    p256dh: sub.p256dh,
                    auth: sub.auth
                }
            };

            try {
                await webpush.sendNotification(pushSubscription, payload);
            } catch (err) {
                // If the subscription is no longer valid (e.g. 410 Gone), remove it from the DB
                if (err.statusCode === 410 || err.statusCode === 404) {
                    console.log(`Deleting expired push subscription ${sub.id}`);
                    await db.query('DELETE FROM push_subscriptions WHERE id = ?', [sub.id]);
                } else {
                    console.error('Error sending push notification:', err);
                }
            }
        });

        await Promise.allSettled(sendPromises);
    } catch (err) {
        console.error('Failed to send push notification to user:', err);
    }
}

module.exports = {
    sendPushToUser
};
