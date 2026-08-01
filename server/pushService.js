require('dotenv').config();
const webpush = require('web-push');
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
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
 * Resolve Firebase service account credentials without committing secrets to git.
 * Priority:
 * 1) FIREBASE_SERVICE_ACCOUNT_JSON — raw JSON string (or base64 of JSON)
 * 2) GOOGLE_APPLICATION_CREDENTIALS — absolute/relative path to a JSON key file
 * 3) Legacy local file server/firebase-service-account.json (dev only; must not be committed)
 */
const resolveFirebaseServiceAccount = () => {
    const rawJson = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
    if (rawJson) {
        try {
            if (rawJson.startsWith('{')) {
                return JSON.parse(rawJson);
            }
            const decoded = Buffer.from(rawJson, 'base64').toString('utf8');
            return JSON.parse(decoded);
        } catch (err) {
            throw new Error(`FIREBASE_SERVICE_ACCOUNT_JSON is invalid JSON: ${err.message}`);
        }
    }

    const credentialsPath = String(process.env.GOOGLE_APPLICATION_CREDENTIALS || '').trim();
    if (credentialsPath) {
        const resolved = path.isAbsolute(credentialsPath)
            ? credentialsPath
            : path.resolve(process.cwd(), credentialsPath);
        if (!fs.existsSync(resolved)) {
            throw new Error(`GOOGLE_APPLICATION_CREDENTIALS file not found: ${resolved}`);
        }
        return JSON.parse(fs.readFileSync(resolved, 'utf8'));
    }

    const legacyPath = path.resolve(__dirname, 'firebase-service-account.json');
    if (fs.existsSync(legacyPath)) {
        console.warn(
            '⚠️ Loading Firebase credentials from server/firebase-service-account.json (legacy). Prefer FIREBASE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS and do not commit this file.'
        );
        return JSON.parse(fs.readFileSync(legacyPath, 'utf8'));
    }

    return null;
};

// Initialize Firebase Admin (for the Android wrapper app)
let firebaseApp = null;
try {
    const serviceAccount = resolveFirebaseServiceAccount();
    if (serviceAccount) {
        firebaseApp = admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        console.log('✅ Firebase Admin initialized with service account credentials.');
    } else if (process.env.FCM_SERVER_KEY) {
        console.warn(
            '⚠️ Found FCM_SERVER_KEY but firebase-admin requires a service account. Set FIREBASE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS.'
        );
    } else {
        console.warn(
            '⚠️ Firebase credentials not configured. Admin app FCM push notifications will not work.'
        );
    }
} catch (e) {
    console.error('Failed to initialize Firebase Admin:', e.message);
}

/**
 * Sends a push notification to all subscribed devices for a specific user (Web Push).
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

const {
    ADMIN_FCM_TOKEN_MAX_AGE_DAYS,
    ADMIN_FCM_TOKEN_PRUNE_INTERVAL_MS
} = require('./config');

function isFirebaseReady() {
    return Boolean(firebaseApp);
}

function getAdminFcmMaxAgeDays() {
    return Math.max(1, Number(ADMIN_FCM_TOKEN_MAX_AGE_DAYS) || 14);
}

/**
 * Delete admin FCM tokens not refreshed within ADMIN_FCM_TOKEN_MAX_AGE_DAYS.
 * @returns {Promise<number>} deleted row count
 */
async function pruneStaleAdminFcmTokens() {
    const days = getAdminFcmMaxAgeDays();
    try {
        const [result] = await db.query(
            `DELETE FROM admin_fcm_tokens
             WHERE updated_at < (NOW() - INTERVAL ${days} DAY)`
        );
        const deleted = result?.affectedRows || 0;
        if (deleted > 0) {
            console.log(`🗑️ pruneStaleAdminFcmTokens: removed ${deleted} token(s) older than ${days}d`);
        }
        return deleted;
    } catch (err) {
        console.error('pruneStaleAdminFcmTokens failed:', err?.message || err);
        return 0;
    }
}

let pruneTimer = null;

/** Run prune once at startup, then on an interval. */
function startAdminFcmTokenPruneWorker() {
    if (pruneTimer) return;
    const run = () => {
        pruneStaleAdminFcmTokens().catch(() => {});
    };
    run();
    pruneTimer = setInterval(run, ADMIN_FCM_TOKEN_PRUNE_INTERVAL_MS);
    if (typeof pruneTimer.unref === 'function') {
        pruneTimer.unref();
    }
    console.log(
        `✅ Admin FCM token prune worker started (maxAge=${getAdminFcmMaxAgeDays()}d, every ${ADMIN_FCM_TOKEN_PRUNE_INTERVAL_MS}ms)`
    );
}

/**
 * Broadcasts an FCM push notification to fresh admin devices only
 * (updated_at within ADMIN_FCM_TOKEN_MAX_AGE_DAYS).
 * Data-only payload so Android AdminMessagingService always runs in background.
 *
 * @param {string} title - Notification title
 * @param {string} body - Notification body
 * @param {object} data - Extra payload data (e.g., type: 'new_order')
 * @returns {Promise<{ successCount: number, failureCount: number, tokenCount: number }>}
 */
async function sendFcmToAdmins(title, body, data = {}) {
    if (!firebaseApp) {
        console.warn('⚠️ sendFcmToAdmins: Firebase not initialized. Skipping.');
        return { successCount: 0, failureCount: 0, tokenCount: 0, skipped: 'firebase_not_ready' };
    }

    try {
        const days = getAdminFcmMaxAgeDays();
        // Belt: never page tokens that have not been refreshed recently
        const [rows] = await db.query(
            `SELECT token FROM admin_fcm_tokens
             WHERE updated_at >= (NOW() - INTERVAL ${days} DAY)`
        );
        if (rows.length === 0) {
            console.warn(
                `⚠️ sendFcmToAdmins: No fresh admin FCM tokens (updated within ${days}d). Skipping.`
            );
            return { successCount: 0, failureCount: 0, tokenCount: 0, skipped: 'no_tokens' };
        }

        const tokens = rows.map(r => r.token).filter(Boolean);
        console.log(`📤 sendFcmToAdmins: Sending to ${tokens.length} fresh device(s). Title: "${title}"`);

        // FCM data values MUST all be strings — stringify any non-strings
        const safeData = {};
        for (const [key, value] of Object.entries(data)) {
            safeData[key] = String(value ?? '');
        }
        safeData.title = String(title || '');
        safeData.body = String(body || '');

        const message = {
            data: safeData,
            tokens,
            android: {
                priority: 'high',
                ttl: 0  // Deliver immediately, don't queue
            }
        };

        console.log(`📤 sendFcmToAdmins: Payload:`, JSON.stringify(message.data));

        const response = await admin.messaging().sendEachForMulticast(message);

        console.log(`📤 sendFcmToAdmins: Results — success: ${response.successCount}, failures: ${response.failureCount}`);

        response.responses.forEach((resp, idx) => {
            if (resp.success) {
                console.log(`  ✅ Token[${idx}]: delivered (messageId: ${resp.messageId})`);
            } else {
                console.error(`  ❌ Token[${idx}]: FAILED — code: ${resp.error?.code}, message: ${resp.error?.message}`);
            }
        });

        if (response.failureCount > 0) {
            const failedTokens = [];
            response.responses.forEach((resp, idx) => {
                if (!resp.success) {
                    const errorCode = resp.error?.code;
                    if (errorCode === 'messaging/invalid-registration-token' ||
                        errorCode === 'messaging/registration-token-not-registered') {
                        failedTokens.push(tokens[idx]);
                    }
                }
            });

            if (failedTokens.length > 0) {
                console.log(`🗑️ Deleting ${failedTokens.length} expired FCM tokens`);
                await db.query('DELETE FROM admin_fcm_tokens WHERE token IN (?)', [failedTokens]);
            }
        }

        return {
            successCount: response.successCount,
            failureCount: response.failureCount,
            tokenCount: tokens.length
        };
    } catch (err) {
        console.error('❌ sendFcmToAdmins EXCEPTION:', err);
        return { successCount: 0, failureCount: 0, tokenCount: 0, error: err.message };
    }
}

module.exports = {
    sendPushToUser,
    sendFcmToAdmins,
    isFirebaseReady,
    pruneStaleAdminFcmTokens,
    startAdminFcmTokenPruneWorker,
    getAdminFcmMaxAgeDays
};
