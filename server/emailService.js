require('dotenv').config();
const nodemailer = require('nodemailer');
const db = require('./db');
const { recordEmailOutboxJob, updateEmailOutboxState } = require('./observability');

const SHOP_TIMEZONE = 'Asia/Kuala_Lumpur';
const BRAND_LOGO_URL = String(
    process.env.BRAND_LOGO_URL ||
        process.env.RECEIPT_LOGO_URL ||
        process.env.VITE_BRAND_LOGO_URL ||
        'https://res.cloudinary.com/dzayh29d7/image/upload/v1771022152/X_d2eevj.png'
).trim();
const PUBLIC_APP_URL = String(
    process.env.PUBLIC_APP_URL ||
        process.env.APP_BASE_URL ||
        process.env.FRONTEND_BASE_URL ||
        process.env.VITE_FRONTEND_URL ||
        ''
)
    .trim()
    .replace(/\/$/, '');
const EMAIL_NOTIFICATIONS_ENABLED = String(process.env.EMAIL_NOTIFICATIONS_ENABLED || 'true')
    .trim()
    .toLowerCase() !== 'false';
const SMTP_HOST = String(process.env.SMTP_HOST || '').trim();
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = String(process.env.SMTP_SECURE || 'false').trim().toLowerCase() === 'true';
const SMTP_USER = String(process.env.SMTP_USER || '').trim();
const SMTP_PASS = String(process.env.SMTP_PASS || '');
const SMTP_FROM_NAME = String(process.env.SMTP_FROM_NAME || 'TakCakap').trim();
const SMTP_FROM_EMAIL = String(process.env.SMTP_FROM_EMAIL || '').trim();
const SMTP_TLS_SERVERNAME = String(process.env.SMTP_TLS_SERVERNAME || '').trim();
const SMTP_TLS_REJECT_UNAUTHORIZED = String(process.env.SMTP_TLS_REJECT_UNAUTHORIZED || 'true')
    .trim()
    .toLowerCase() !== 'false';
const REFUND_TIMEFRAME_LABEL = String(
    process.env.REFUND_TIMEFRAME_LABEL || 'Instant when available, otherwise up to 10 business days.'
).trim();
const SIMPLE_EMAIL_REGEX = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;

const ORDER_EVENT_CONFIG = {
    payment_success: {
        sentAtColumn: 'payment_success_email_sent_at',
        subjectPrefix: 'Payment Successful',
        title: 'Payment Successful',
        accent: '#d61ec9'
    },
    completed: {
        sentAtColumn: 'order_completed_email_sent_at',
        subjectPrefix: 'Order Completed',
        title: 'Order Completed',
        accent: '#1ca66b'
    },
    cancelled: {
        sentAtColumn: 'order_cancelled_email_sent_at',
        subjectPrefix: 'Order Cancelled',
        title: 'Order Cancelled',
        accent: '#d43f3f'
    },
    cancelled_refund: {
        sentAtColumn: 'refund_initiated_email_sent_at',
        subjectPrefix: 'Order Cancelled - Refund Initiated',
        title: 'Refund In Progress',
        accent: '#0d9488'
    }
};
const EMAIL_OUTBOX_BATCH_SIZE = Math.max(
    1,
    Number.parseInt(String(process.env.EMAIL_OUTBOX_BATCH_SIZE || '10'), 10) || 10
);
const EMAIL_OUTBOX_POLL_MS = Math.max(
    1000,
    Number.parseInt(String(process.env.EMAIL_OUTBOX_POLL_MS || '2000'), 10) || 2000
);
const EMAIL_OUTBOX_LOCK_SECONDS = Math.max(
    15,
    Number.parseInt(String(process.env.EMAIL_OUTBOX_LOCK_SECONDS || '60'), 10) || 60
);
const EMAIL_OUTBOX_MAX_ATTEMPTS = Math.max(
    1,
    Number.parseInt(String(process.env.EMAIL_OUTBOX_MAX_ATTEMPTS || '8'), 10) || 8
);

let transporter = null;
let configWarningPrinted = false;
let workerTimer = null;
let workerInFlight = false;

const formatMoneyMYR = (value) => `RM${Number(value || 0).toFixed(2)}`;
const escapeHtml = (value) =>
    String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');

const formatDateTime = (value) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString('en-MY', {
        timeZone: SHOP_TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });
};

const buildPublicUrl = (path) => {
    if (!PUBLIC_APP_URL) return '';
    const normalizedPath = String(path || '').startsWith('/') ? path : `/${path || ''}`;
    return `${PUBLIC_APP_URL}${normalizedPath}`;
};

const isMailerConfigured = () =>
    EMAIL_NOTIFICATIONS_ENABLED && SMTP_HOST && isSafeSingleEmailAddress(SMTP_FROM_EMAIL);
const isSafeSingleEmailAddress = (value) => {
    const normalized = String(value || '').trim();
    if (!normalized || normalized.length > 254) return false;
    if (/[\r\n,;<>]/.test(normalized)) return false;
    return SIMPLE_EMAIL_REGEX.test(normalized);
};

const getTransporter = () => {
    if (!isMailerConfigured()) {
        if (!configWarningPrinted) {
            console.warn(
                '[Email] Notifications disabled or incomplete SMTP config. Set SMTP_HOST + SMTP_FROM_EMAIL (+ auth when required).'
            );
            configWarningPrinted = true;
        }
        return null;
    }

    if (transporter) return transporter;

    const tlsConfig = {};
    if (SMTP_TLS_SERVERNAME) tlsConfig.servername = SMTP_TLS_SERVERNAME;
    if (!SMTP_TLS_REJECT_UNAUTHORIZED) tlsConfig.rejectUnauthorized = false;

    transporter = nodemailer.createTransport({
        host: SMTP_HOST,
        port: Number.isFinite(SMTP_PORT) ? SMTP_PORT : 587,
        secure: SMTP_SECURE,
        auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
        tls: Object.keys(tlsConfig).length > 0 ? tlsConfig : undefined
    });

    return transporter;
};

const loadOrderEmailModel = async (orderId) => {
    const [orderRows] = await db.query(
        `
            SELECT
                o.id,
                o.user_id,
                o.status,
                o.total_amount,
                o.created_at,
                o.order_type,
                o.delivery_provider,
                o.delivery_timing,
                o.scheduled_at_utc,
                o.delivery_address,
                o.delivery_label_snapshot,
                o.delivery_note_snapshot,
                o.delivery_contact_phone,
                o.recipient_name_snapshot,
                o.payment_method,
                o.delivery_fee,
                o.delivery_currency,
                o.external_order_id,
                o.tracking_url,
                o.payment_success_email_sent_at,
                o.order_completed_email_sent_at,
                o.order_cancelled_email_sent_at,
                o.refund_initiated_email_sent_at,
                o.refund_status,
                o.refund_amount,
                u.name AS customer_name,
                u.email AS customer_email,
                v.code AS voucher_code,
                o.discount_amount AS voucher_discount
            FROM orders o
            LEFT JOIN users u ON u.id = o.user_id
            LEFT JOIN vouchers v ON o.voucher_id = v.id
            WHERE o.id = ?
            LIMIT 1
        `,
        [orderId]
    );

    const order = orderRows[0];
    if (!order) return null;

    const [itemRows] = await db.query(
        `
            SELECT
                oi.menu_item_id,
                oi.item_name_snapshot,
                oi.quantity,
                oi.unit_price,
                m.name AS menu_name
            FROM order_items oi
            LEFT JOIN menu_items m ON m.id = oi.menu_item_id
            WHERE oi.order_id = ?
            ORDER BY oi.id ASC
        `,
        [orderId]
    );

    const items = itemRows.map((row) => {
        const quantity = Number(row.quantity || 0);
        const unitPrice = Number(row.unit_price || 0);
        return {
            name: String(row.item_name_snapshot || row.menu_name || `Menu Item #${row.menu_item_id}`),
            quantity,
            unitPrice,
            lineTotal: quantity * unitPrice
        };
    });

    const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
    const deliveryFee = Number(order.delivery_fee || 0);
    const total = Number(order.total_amount || 0);
    const serviceFee = Math.max(total - subtotal - deliveryFee, 0);

    return {
        ...order,
        items,
        subtotal,
        serviceFee,
        deliveryFee,
        total,
        orderNumber: `#${String(order.id)}`,
        createdAtLabel: formatDateTime(order.created_at),
        scheduledAtLabel: order.scheduled_at_utc ? formatDateTime(order.scheduled_at_utc) : ''
    };
};

const renderOrderRowsHtml = (order) => {
    const rows = order.items
        .map(
            (item) => `
                <tr>
                    <td style="padding:10px 0; font-size:14px; color:#151515;">${escapeHtml(item.name)}</td>
                    <td style="padding:10px 0; font-size:14px; color:#4b5563; text-align:right;">${item.quantity}</td>
                    <td style="padding:10px 0; font-size:14px; color:#151515; text-align:right;">${formatMoneyMYR(item.lineTotal)}</td>
                </tr>
            `
        )
        .join('');

    return `
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse; margin-top:6px;">
            <thead>
                <tr>
                    <th style="text-align:left; font-size:12px; text-transform:uppercase; color:#6b7280; padding-bottom:8px; border-bottom:1px solid #f0f0f0;">Item</th>
                    <th style="text-align:right; font-size:12px; text-transform:uppercase; color:#6b7280; padding-bottom:8px; border-bottom:1px solid #f0f0f0;">Qty</th>
                    <th style="text-align:right; font-size:12px; text-transform:uppercase; color:#6b7280; padding-bottom:8px; border-bottom:1px solid #f0f0f0;">Total</th>
                </tr>
            </thead>
            <tbody>
                ${rows || '<tr><td colspan="3" style="padding-top:10px; color:#6b7280; font-size:13px;">No items</td></tr>'}
            </tbody>
        </table>
    `;
};

const getEventMessageHtml = (eventType, order) => {
    const orderHistoryUrl = buildPublicUrl('/orders');

    if (eventType === 'payment_success') {
        const trackingBlock =
            order.order_type === 'Delivery' && order.tracking_url
                ? `
                    <p style="margin:8px 0 0; color:#374151; font-size:14px;">Track your rider:</p>
                    <p style="margin:10px 0 0;">
                        <a href="${escapeHtml(order.tracking_url)}" style="display:inline-block; background:#d61ec9; color:#ffffff; font-weight:700; font-size:13px; text-decoration:none; border-radius:999px; padding:10px 16px;">Open Lalamove Tracking</a>
                    </p>
                `
                : '';

        return `
            <p style="margin:0; color:#374151; font-size:14px; line-height:1.6;">
                We have received your payment. Your order is now being processed.
            </p>
            ${trackingBlock}
            ${orderHistoryUrl ? `<p style="margin:10px 0 0;"><a href="${escapeHtml(orderHistoryUrl)}" style="display:inline-block; background:#111827; color:#ffffff; font-weight:700; font-size:13px; text-decoration:none; border-radius:999px; padding:10px 16px;">View Order History</a></p>` : ''}
        `;
    }

    if (eventType === 'completed') {
        return `
            <p style="margin:0; color:#374151; font-size:14px; line-height:1.6;">
                Your order has been marked as completed. Your receipt summary is below.
            </p>
            <p style="margin:10px 0 0; color:#374151; font-size:14px; line-height:1.6;">
                Need the official PDF receipt? Download it anytime from your order history.
            </p>
            ${orderHistoryUrl ? `<p style="margin:10px 0 0;"><a href="${escapeHtml(orderHistoryUrl)}" style="display:inline-block; background:#111827; color:#ffffff; font-weight:700; font-size:13px; text-decoration:none; border-radius:999px; padding:10px 16px;">Open Order History</a></p>` : ''}
        `;
    }

    if (eventType === 'cancelled_refund') {
        const refundStatus = String(order.refund_status || '').trim().toLowerCase();
        const refundStatusLine =
            refundStatus === 'processed'
                ? 'Your refund has been processed successfully.'
                : refundStatus === 'failed'
                  ? 'We attempted your refund, but it was not completed. Please contact support.'
                  : `Your refund is on the way. Expected timeline: ${escapeHtml(REFUND_TIMEFRAME_LABEL)}`;
        return `
            <p style="margin:0; color:#374151; font-size:14px; line-height:1.6;">
                Refund processing has started for your order.
            </p>
            <p style="margin:10px 0 0; color:#374151; font-size:14px; line-height:1.6;">
                ${refundStatusLine}
            </p>
            ${orderHistoryUrl ? `<p style="margin:10px 0 0;"><a href="${escapeHtml(orderHistoryUrl)}" style="display:inline-block; background:#111827; color:#ffffff; font-weight:700; font-size:13px; text-decoration:none; border-radius:999px; padding:10px 16px;">Check Order History</a></p>` : ''}
        `;
    }

    return `
        <p style="margin:0; color:#374151; font-size:14px; line-height:1.6;">
            Your order has been cancelled. If payment was captured, please contact support for refund status.
        </p>
        ${orderHistoryUrl ? `<p style="margin:10px 0 0;"><a href="${escapeHtml(orderHistoryUrl)}" style="display:inline-block; background:#111827; color:#ffffff; font-weight:700; font-size:13px; text-decoration:none; border-radius:999px; padding:10px 16px;">Check Order History</a></p>` : ''}
    `;
};

const buildEmailContent = ({ eventType, order, eventConfig }) => {
    const subject = `${eventConfig.subjectPrefix} - Order ${order.orderNumber}`;
    const brandHomeUrl = buildPublicUrl('/') || 'https://takcakap.com';
    const logoHtml = BRAND_LOGO_URL
        ? `<img src="${escapeHtml(BRAND_LOGO_URL)}" alt="TakCakap" style="height:44px; width:auto; display:block; margin:0 auto 16px;" />`
        : '';

    const deliveryMeta =
        order.order_type === 'Delivery'
            ? `
                <p style="margin:6px 0 0; color:#4b5563; font-size:13px;">
                    <strong>Delivery:</strong> ${escapeHtml(order.delivery_provider || 'Delivery')}
                </p>
                ${order.delivery_address ? `<p style="margin:4px 0 0; color:#4b5563; font-size:13px;"><strong>Address:</strong> ${escapeHtml(order.delivery_address)}</p>` : ''}
                ${order.delivery_contact_phone ? `<p style="margin:4px 0 0; color:#4b5563; font-size:13px;"><strong>Phone:</strong> ${escapeHtml(order.delivery_contact_phone)}</p>` : ''}
            `
            : `<p style="margin:6px 0 0; color:#4b5563; font-size:13px;"><strong>Pickup:</strong> Self pickup</p>`;

    const scheduleMeta =
        String(order.delivery_timing || '').toUpperCase() === 'SCHEDULED' && order.scheduledAtLabel
            ? `<p style="margin:4px 0 0; color:#4b5563; font-size:13px;"><strong>Scheduled:</strong> ${escapeHtml(order.scheduledAtLabel)}</p>`
            : '';

    const html = `
<!doctype html>
<html>
  <body style="margin:0; padding:0; background:#f7f5f8; font-family:Arial,Helvetica,sans-serif; color:#111827;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px; background:#ffffff; border:1px solid #f0e6f3; border-radius:18px; overflow:hidden;">
            <tr>
              <td style="padding:26px 24px 18px; background:linear-gradient(135deg, #fff5ff 0%, #ffffff 100%); border-bottom:1px solid #f4ecf6;">
                ${logoHtml}
                <h1 style="margin:0; text-align:center; font-size:24px; line-height:1.2; color:#111827;">${escapeHtml(eventConfig.title)}</h1>
                <p style="margin:10px 0 0; text-align:center; color:#6b7280; font-size:13px;">TakCakap Order ${escapeHtml(order.orderNumber)}</p>
                <div style="margin:14px auto 0; width:max-content; background:${escapeHtml(eventConfig.accent)}; color:#fff; font-size:12px; font-weight:700; letter-spacing:0.5px; text-transform:uppercase; padding:7px 12px; border-radius:999px;">
                  ${escapeHtml(order.status || '')}
                </div>
              </td>
            </tr>

            <tr>
              <td style="padding:20px 24px 8px;">
                ${getEventMessageHtml(eventType, order)}
              </td>
            </tr>

            <tr>
              <td style="padding:12px 24px 8px;">
                <div style="background:#fafafa; border:1px solid #efefef; border-radius:12px; padding:14px;">
                  <p style="margin:0; font-size:13px; color:#4b5563;"><strong>Order ID:</strong> ${escapeHtml(order.orderNumber)}</p>
                  <p style="margin:4px 0 0; font-size:13px; color:#4b5563;"><strong>Date:</strong> ${escapeHtml(order.createdAtLabel || '')}</p>
                  <p style="margin:4px 0 0; font-size:13px; color:#4b5563;"><strong>Payment:</strong> ${escapeHtml(order.payment_method || 'Curlec')}</p>
                  ${deliveryMeta}
                  ${scheduleMeta}
                </div>
              </td>
            </tr>

            <tr>
              <td style="padding:8px 24px 8px;">
                <h3 style="margin:0 0 8px; font-size:16px; color:#111827;">Receipt Summary</h3>
                ${renderOrderRowsHtml(order)}
              </td>
            </tr>

            <tr>
              <td style="padding:8px 24px 24px;">
                <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse; margin-top:6px;">
                  <tr>
                    <td style="padding:6px 0; font-size:13px; color:#6b7280;">Subtotal</td>
                    <td style="padding:6px 0; font-size:13px; color:#111827; text-align:right;">${formatMoneyMYR(order.subtotal)}</td>
                  </tr>
                  <tr>
                    <td style="padding:6px 0; font-size:13px; color:#6b7280;">Service Fee</td>
                    <td style="padding:6px 0; font-size:13px; color:#111827; text-align:right;">${formatMoneyMYR(order.serviceFee)}</td>
                  </tr>
                  ${order.order_type === 'Delivery' ? `<tr><td style="padding:6px 0; font-size:13px; color:#6b7280;">Delivery Fee</td><td style="padding:6px 0; font-size:13px; color:#111827; text-align:right;">${formatMoneyMYR(order.deliveryFee)}</td></tr>` : ''}
                  ${order.voucher_code && Number(order.voucher_discount) > 0 ? `<tr><td style="padding:6px 0; font-size:13px; color:#6b7280;">Voucher (${escapeHtml(order.voucher_code)})</td><td style="padding:6px 0; font-size:13px; color:#059669; text-align:right;">-${formatMoneyMYR(Number(order.voucher_discount))}</td></tr>` : ''}
                  <tr>
                    <td style="padding:10px 0 0; border-top:1px solid #ececec; font-size:14px; font-weight:700; color:#111827;">Grand Total</td>
                    <td style="padding:10px 0 0; border-top:1px solid #ececec; font-size:16px; font-weight:800; color:${escapeHtml(eventConfig.accent)}; text-align:right;">${formatMoneyMYR(order.total)}</td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding:0 24px 20px; color:#9ca3af; font-size:12px; text-align:center;">
                This is an automated email from <a href="${escapeHtml(brandHomeUrl)}" style="color:#d61ec9; text-decoration:none; font-weight:700;">TakCakap.com</a> .
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

    const text = [
        `${eventConfig.subjectPrefix} - Order ${order.orderNumber}`,
        '',
        `Status: ${order.status || ''}`,
        `Order Date: ${order.createdAtLabel || ''}`,
        `Order Type: ${order.order_type || ''}`,
        `Payment: ${order.payment_method || 'Curlec'}`,
        eventType === 'cancelled_refund'
            ? `Refund Timeline: ${
                  String(order.refund_status || '').trim().toLowerCase() === 'processed'
                      ? 'Processed'
                      : REFUND_TIMEFRAME_LABEL
              }`
            : '',
        order.order_type === 'Delivery' && order.tracking_url ? `Tracking: ${order.tracking_url}` : '',
        PUBLIC_APP_URL ? `Order History: ${buildPublicUrl('/orders')}` : '',
        '',
        `Total: ${formatMoneyMYR(order.total)}`
    ]
        .filter(Boolean)
        .join('\n');

    return { subject, html, text };
};

const markEmailEventSent = async (orderId, sentAtColumn) => {
    await db.query(
        `
            UPDATE orders
            SET ${sentAtColumn} = UTC_TIMESTAMP()
            WHERE id = ?
              AND ${sentAtColumn} IS NULL
        `,
        [orderId]
    );
};

const sendOrderEventEmail = async (orderId, eventType) => {
    const eventConfig = ORDER_EVENT_CONFIG[eventType];
    if (!eventConfig) {
        throw new Error(`Unsupported email event type: ${eventType}`);
    }

    const mailer = getTransporter();
    if (!mailer) return;

    const order = await loadOrderEmailModel(orderId);
    if (!order) return;

    const recipientEmail = String(order.customer_email || '').trim();
    if (!recipientEmail) {
        console.warn(`[Email] Order ${orderId} has no customer email, skipping ${eventType} notification.`);
        return;
    }
    if (!isSafeSingleEmailAddress(recipientEmail)) {
        console.warn(`[Email] Order ${orderId} has invalid recipient email format, skipping ${eventType} notification.`);
        return;
    }

    if (order[eventConfig.sentAtColumn]) {
        return;
    }

    const content = buildEmailContent({ eventType, order, eventConfig });

    await mailer.sendMail({
        from: SMTP_FROM_NAME ? `"${SMTP_FROM_NAME}" <${SMTP_FROM_EMAIL}>` : SMTP_FROM_EMAIL,
        to: recipientEmail,
        subject: content.subject,
        html: content.html,
        text: content.text
    });

    await markEmailEventSent(orderId, eventConfig.sentAtColumn);
    console.log(`[Email] ${eventType} email sent for order ${orderId} to ${recipientEmail}`);
};

const enqueueOrderEventEmail = async (orderId, eventType) => {
    const parsedOrderId = Number(orderId);
    if (!Number.isInteger(parsedOrderId) || parsedOrderId <= 0) return;
    if (!ORDER_EVENT_CONFIG[eventType]) return;

    await db.query(
        `
            INSERT INTO email_outbox (
                order_id,
                event_type,
                status,
                attempt_count,
                next_attempt_at,
                locked_at,
                sent_at,
                last_error,
                created_at,
                updated_at
            )
            VALUES (?, ?, 'pending', 0, NULL, NULL, NULL, NULL, UTC_TIMESTAMP(), UTC_TIMESTAMP())
            ON DUPLICATE KEY UPDATE
                status = CASE
                    WHEN status = 'sent' THEN status
                    ELSE 'pending'
                END,
                next_attempt_at = CASE
                    WHEN status = 'sent' THEN next_attempt_at
                    ELSE NULL
                END,
                locked_at = NULL,
                last_error = CASE
                    WHEN status = 'sent' THEN last_error
                    ELSE NULL
                END,
                updated_at = UTC_TIMESTAMP()
        `,
        [parsedOrderId, eventType]
    );
    recordEmailOutboxJob({ status: 'queued', eventType });
};

const queueOrderEventEmail = (orderId, eventType) => {
    enqueueOrderEventEmail(orderId, eventType).catch((error) => {
        console.error(
            `[Email] Failed to enqueue ${eventType} email for order ${orderId}:`,
            error?.message || error
        );
    });
};

const claimOutboxJobs = async (limit) => {
    const lockCutoffDate = new Date(Date.now() - EMAIL_OUTBOX_LOCK_SECONDS * 1000);
    const lockCutoffSql = lockCutoffDate.toISOString().slice(0, 19).replace('T', ' ');
    const [candidates] = await db.query(
        `
            SELECT id, order_id, event_type, attempt_count
            FROM email_outbox
            WHERE (
                (
                    status IN ('pending', 'failed')
                    AND (next_attempt_at IS NULL OR next_attempt_at <= UTC_TIMESTAMP())
                    AND (locked_at IS NULL OR locked_at < ?)
                )
                OR (status = 'processing' AND locked_at < ?)
            )
            ORDER BY created_at ASC, id ASC
            LIMIT ?
        `,
        [lockCutoffSql, lockCutoffSql, limit]
    );
    if (!Array.isArray(candidates) || candidates.length === 0) return [];

    const claimed = [];
    for (const candidate of candidates) {
        const outboxId = Number(candidate.id);
        if (!Number.isInteger(outboxId) || outboxId <= 0) continue;

        const [updateResult] = await db.query(
            `
                UPDATE email_outbox
                SET status = 'processing', locked_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP()
                WHERE id = ?
                  AND (
                        (
                            status IN ('pending', 'failed')
                            AND (next_attempt_at IS NULL OR next_attempt_at <= UTC_TIMESTAMP())
                            AND (locked_at IS NULL OR locked_at < ?)
                        )
                        OR (status = 'processing' AND locked_at < ?)
                    )
            `,
            [outboxId, lockCutoffSql, lockCutoffSql]
        );
        if (updateResult?.affectedRows === 1) {
            claimed.push({
                id: outboxId,
                orderId: Number(candidate.order_id),
                eventType: String(candidate.event_type || ''),
                attemptCount: Number(candidate.attempt_count || 0)
            });
        }
    }
    return claimed;
};

const markOutboxJobSent = async (jobId) => {
    await db.query(
        `
            UPDATE email_outbox
            SET
                status = 'sent',
                sent_at = UTC_TIMESTAMP(),
                locked_at = NULL,
                last_error = NULL,
                updated_at = UTC_TIMESTAMP()
            WHERE id = ?
        `,
        [jobId]
    );
};

const computeRetryDelaySeconds = (attemptCount) => {
    const base = Math.min(Math.max(1, attemptCount), 8);
    return Math.min(30 * 60, Math.max(15, 5 * 2 ** base));
};

const markOutboxJobFailed = async (job, error) => {
    const nextAttemptCount = Number(job.attemptCount || 0) + 1;
    const normalizedError = String(error?.message || error || 'Email sending failed').slice(0, 500);

    if (nextAttemptCount >= EMAIL_OUTBOX_MAX_ATTEMPTS) {
        await db.query(
            `
                UPDATE email_outbox
                SET
                    status = 'failed_permanent',
                    attempt_count = ?,
                    locked_at = NULL,
                    next_attempt_at = NULL,
                    last_error = ?,
                    updated_at = UTC_TIMESTAMP()
                WHERE id = ?
            `,
            [nextAttemptCount, normalizedError, job.id]
        );
        return 'failed_permanent';
    }

    const delaySeconds = computeRetryDelaySeconds(nextAttemptCount);
    await db.query(
        `
            UPDATE email_outbox
            SET
                status = 'failed',
                attempt_count = ?,
                locked_at = NULL,
                next_attempt_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND),
                last_error = ?,
                updated_at = UTC_TIMESTAMP()
            WHERE id = ?
        `,
        [nextAttemptCount, delaySeconds, normalizedError, job.id]
    );
    return 'failed';
};

const refreshOutboxLagMetrics = async () => {
    const [rows] = await db.query(
        `
            SELECT
                COUNT(*) AS pending_count,
                TIMESTAMPDIFF(SECOND, MIN(created_at), UTC_TIMESTAMP()) AS oldest_pending_seconds
            FROM email_outbox
            WHERE status IN ('pending', 'failed')
        `
    );
    const row = rows[0] || {};
    updateEmailOutboxState({
        pendingCount: Number(row.pending_count || 0),
        oldestPendingSeconds: Number(row.oldest_pending_seconds || 0)
    });
};

const processOutboxCycle = async () => {
    if (workerInFlight) return;
    workerInFlight = true;
    try {
        const jobs = await claimOutboxJobs(EMAIL_OUTBOX_BATCH_SIZE);
        if (!jobs.length) return;

        for (const job of jobs) {
            try {
                await sendOrderEventEmail(job.orderId, job.eventType);
                await markOutboxJobSent(job.id);
                recordEmailOutboxJob({ status: 'sent', eventType: job.eventType });
            } catch (error) {
                const failedStatus = await markOutboxJobFailed(job, error);
                recordEmailOutboxJob({
                    status: failedStatus || 'failed',
                    eventType: job.eventType
                });
                console.error(
                    `[Email] Failed processing outbox job #${job.id} (${job.eventType} for order ${job.orderId}):`,
                    error?.message || error
                );
            }
        }
    } finally {
        await refreshOutboxLagMetrics().catch(() => null);
        workerInFlight = false;
    }
};

const startWorker = () => {
    if (workerTimer) return;

    const run = () => {
        processOutboxCycle().catch((error) => {
            console.error('[Email] Outbox worker cycle failed:', error?.message || error);
        });
    };

    workerTimer = setInterval(run, EMAIL_OUTBOX_POLL_MS);
    if (typeof workerTimer.unref === 'function') {
        workerTimer.unref();
    }
    run();
};

const sendVoucherEmail = async (userId, voucherCode, discountValue) => {
    const mailer = getTransporter();
    if (!mailer) return;

    const [userRows] = await db.query(`SELECT email, name FROM users WHERE id = ?`, [userId]);
    const user = userRows[0];
    if (!user || !user.email) return;

    const html = `
<!doctype html>
<html>
  <body style="margin:0; padding:0; background:#f7f5f8; font-family:Arial,Helvetica,sans-serif; color:#111827;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px; background:#ffffff; border:1px solid #f0e6f3; border-radius:18px; overflow:hidden;">
            <tr>
              <td style="padding:26px 24px 18px; background:linear-gradient(135deg, #fff5ff 0%, #ffffff 100%); border-bottom:1px solid #f4ecf6;">
                <h1 style="margin:0; text-align:center; font-size:24px; line-height:1.2; color:#111827;">Here is your Voucher!</h1>
                <p style="margin:10px 0 0; text-align:center; color:#6b7280; font-size:13px;">Redeemed with your points</p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 24px 8px;">
                <p>Hi ${escapeHtml(user.name)},</p>
                <p>You have successfully redeemed a voucher worth RM${Number(discountValue).toFixed(2)}!</p>
                <div style="background:#fafafa; border:1px solid #efefef; border-radius:12px; padding:14px; text-align:center;">
                  <strong style="font-size:20px; color:#d61ec9;">${escapeHtml(voucherCode)}</strong>
                </div>
                <p>Use this code at checkout to apply your discount. The voucher is valid for 30 days.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

    await mailer.sendMail({
        from: SMTP_FROM_NAME ? `"${SMTP_FROM_NAME}" <${SMTP_FROM_EMAIL}>` : SMTP_FROM_EMAIL,
        to: user.email,
        subject: 'Your TakCakap Voucher Code',
        html: html,
        text: `Here is your voucher code: ${voucherCode}. It gives you a discount of RM${Number(discountValue).toFixed(2)}.`
    });
};

const queueVoucherEmail = (userId, voucherCode, discountValue) => {
    sendVoucherEmail(userId, voucherCode, discountValue).catch((error) => {
        console.error(`[Email] Failed to send voucher email for user ${userId}:`, error?.message || error);
    });
};

const sendPointsClawbackEmail = async ({ userId, orderId, points, balance, debtPoints }) => {
    if (!EMAIL_NOTIFICATIONS_ENABLED || !SMTP_HOST || !SMTP_FROM_EMAIL) return;
    const [users] = await db.query(`SELECT email, name FROM users WHERE id = ? LIMIT 1`, [userId]);
    const user = users[0];
    if (!user?.email) return;
    const debtNote =
        Number(debtPoints) > 0
            ? `You currently have a ${debtPoints}-point debt. New points from future completed orders will clear this first. Redemptions are blocked until your balance is 0 or higher.`
            : 'Your points balance is non-negative again.';
    const mailer = nodemailer.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: SMTP_SECURE,
        auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
        tls: {
            servername: SMTP_TLS_SERVERNAME || undefined,
            rejectUnauthorized: SMTP_TLS_REJECT_UNAUTHORIZED
        }
    });
    await mailer.sendMail({
        from: SMTP_FROM_NAME ? `"${SMTP_FROM_NAME}" <${SMTP_FROM_EMAIL}>` : SMTP_FROM_EMAIL,
        to: user.email,
        subject: 'TakCakap points updated after refund',
        text: [
            `Hi ${user.name || 'there'},`,
            ``,
            `We reversed ${points} loyalty points for order #${orderId} because of a refund.`,
            `Your current balance is ${balance} points.`,
            debtNote,
            ``,
            `— TakCakap`
        ].join('\n')
    });
};

const queuePointsClawbackEmail = (payload) => {
    sendPointsClawbackEmail(payload).catch((error) => {
        console.error('[Email] Failed to send points clawback email:', error?.message || error);
    });
};

const sendVoucherRestoredEmail = async ({ userId, orderId, code }) => {
    if (!EMAIL_NOTIFICATIONS_ENABLED || !SMTP_HOST || !SMTP_FROM_EMAIL || !userId || !code) return;
    const [users] = await db.query(`SELECT email, name FROM users WHERE id = ? LIMIT 1`, [userId]);
    const user = users[0];
    if (!user?.email) return;
    const mailer = nodemailer.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: SMTP_SECURE,
        auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
        tls: {
            servername: SMTP_TLS_SERVERNAME || undefined,
            rejectUnauthorized: SMTP_TLS_REJECT_UNAUTHORIZED
        }
    });
    await mailer.sendMail({
        from: SMTP_FROM_NAME ? `"${SMTP_FROM_NAME}" <${SMTP_FROM_EMAIL}>` : SMTP_FROM_EMAIL,
        to: user.email,
        subject: 'Your TakCakap voucher was restored',
        text: [
            `Hi ${user.name || 'there'},`,
            ``,
            `Because order #${orderId} was refunded, voucher code ${code} has been restored to your account (usage counter reduced).`,
            `If the voucher is still within its expiry date, you can use it on a future order.`,
            ``,
            `— TakCakap`
        ].join('\n')
    });
};

const queueVoucherRestoredEmail = (payload) => {
    sendVoucherRestoredEmail(payload).catch((error) => {
        console.error('[Email] Failed to send voucher restored email:', error?.message || error);
    });
};

module.exports = {
    sendOrderEventEmail,
    queueOrderEventEmail,
    startWorker,
    queueVoucherEmail,
    queuePointsClawbackEmail,
    queueVoucherRestoredEmail
};
