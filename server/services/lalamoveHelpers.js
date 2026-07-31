/**
 * Lalamove domain helpers (remarks, cancel windows, quote reservation).
 * API client remains in lalamoveService.js.
 */
'use strict';

const {
    LALAMOVE_DEFAULT_REMARK_TEMPLATE,
    LALAMOVE_REMARK_MAX_LENGTH,
    LALAMOVE_CANCEL_LIMIT_SECONDS,
    SHOP_TIMEZONE
} = require('../config');
const {
    toPositiveInteger,
    toUtcIsoString,
    toSqlDateTimeUtc,
    normalizeCurrencyCode
} = require('../lib/primitives');
const { toMinorUnitsAllowZero, fromMinorUnits } = require('../lib/money');

const normalizeRemarkText = (value) => String(value || '').replace(/\s+/g, ' ').trim();
const clampLalamoveRemark = (value) => normalizeRemarkText(value).slice(0, LALAMOVE_REMARK_MAX_LENGTH);
const buildLalamoveDefaultRemark = ({ orderId, userName }) => {
    const normalizedOrderId = toPositiveInteger(orderId);
    const safeOrderId = normalizedOrderId ? String(normalizedOrderId) : String(orderId || '').trim() || 'N/A';
    const safeUserName = normalizeRemarkText(userName) || 'Customer';
    const fallback = `Order #${safeOrderId} | User: ${safeUserName}`;
    const template = normalizeRemarkText(LALAMOVE_DEFAULT_REMARK_TEMPLATE);
    if (!template) {
        return clampLalamoveRemark(fallback);
    }

    const renderedTemplate = template
        .replace(/\{orderId\}/gi, safeOrderId)
        .replace(/\{orderNo\}/gi, safeOrderId)
        .replace(/\{userName\}/gi, safeUserName)
        .replace(/\{customerName\}/gi, safeUserName);
    const normalizedTemplate = clampLalamoveRemark(renderedTemplate);
    if (!normalizedTemplate) {
        return clampLalamoveRemark(fallback);
    }

    const hasOrderId = normalizedTemplate.includes(safeOrderId);
    const hasUserName = normalizedTemplate.toLowerCase().includes(safeUserName.toLowerCase());
    if (!hasOrderId || !hasUserName) {
        return clampLalamoveRemark(fallback);
    }
    return normalizedTemplate;
};

const buildLalamoveRecipientRemark = ({ shortCode, userName, customerRemark }) => {
    const maxLimit = LALAMOVE_REMARK_MAX_LENGTH; // e.g. 80
    const cleanCustomerRemark = normalizeRemarkText(customerRemark);
    
    // Parse the 3-digit suffix (e.g. "AAA-001" -> "001")
    const codePart = String(shortCode || '').includes('-') 
        ? String(shortCode).split('-')[1] 
        : '000';

    // Get first word of username truncated to 8 characters
    const firstWord = String(userName || '').trim().split(/\s+/)[0] || 'Cust';
    const truncatedUserName = firstWord.slice(0, 8);

    // Prefix format: "#001-JohnD-"
    const prefix = `#${codePart}-${truncatedUserName}-`;

    if (!cleanCustomerRemark) {
        return prefix.slice(0, -1);
    }

    const availableSpace = maxLimit - prefix.length;
    if (availableSpace > 0) {
        return `${prefix}${cleanCustomerRemark.slice(0, availableSpace)}`;
    }

    return cleanCustomerRemark.slice(0, maxLimit);
};

const isLalamoveInvalidQuotationError = (error) => {
    const errorId = String(error?.payload?.errors?.[0]?.id || '').trim().toUpperCase();
    if (errorId === 'ERR_INVALID_QUOTATION_ID') return true;
    const rawMessage = String(
        error?.payload?.errors?.[0]?.message ||
        error?.payload?.errors?.[0]?.detail ||
        error?.payload?.message ||
        error?.message ||
        ''
    )
        .trim()
        .toLowerCase();
    if (!rawMessage) return false;
    return rawMessage.includes('quotation') && (rawMessage.includes('invalid') || rawMessage.includes('expire'));
};

const extractLalamoveStopIds = (stops) => {
    const normalizedStops = Array.isArray(stops) ? stops : [];
    const senderStopId = String(normalizedStops?.[0]?.stopId || '').trim();
    const recipientStopId = String(normalizedStops?.[normalizedStops.length - 1]?.stopId || '').trim();
    return {
        senderStopId,
        recipientStopId
    };
};
const formatScheduledAtLabel = (utcIsoString) => {
    const iso = toUtcIsoString(utcIsoString);
    if (!iso) return '';
    return new Date(iso).toLocaleString('en-MY', {
        timeZone: SHOP_TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });
};
const computeLalamoveCancelState = ({ deliveryProvider, lalamoveStatus, lalamoveOngoingAtUtc }) => {
    if (deliveryProvider !== 'Lalamove') {
        return {
            canCancelLalamove: false,
            cancelWindowMode: 'CLOSED',
            cancelWindowRemainingSeconds: 0,
            cancelWindowEndsAtUtc: null
        };
    }

    const normalizedStatus = String(lalamoveStatus || '').toUpperCase();
    const terminalOrForbiddenStatuses = new Set([
        'PICKED_UP',
        'COMPLETED',
        'CANCELED',
        'CANCELLED',
        'EXPIRED',
        'REJECTED'
    ]);
    if (terminalOrForbiddenStatuses.has(normalizedStatus)) {
        return {
            canCancelLalamove: false,
            cancelWindowMode: 'CLOSED',
            cancelWindowRemainingSeconds: 0,
            cancelWindowEndsAtUtc: null
        };
    }

    const ongoingIso = toUtcIsoString(lalamoveOngoingAtUtc);
    if (ongoingIso) {
        const endsAtMs = new Date(ongoingIso).getTime() + LALAMOVE_CANCEL_LIMIT_SECONDS * 1000;
        const remainingSeconds = Math.max(0, Math.floor((endsAtMs - Date.now()) / 1000));
        return {
            canCancelLalamove: remainingSeconds > 0,
            cancelWindowMode: remainingSeconds > 0 ? 'LIMITED' : 'CLOSED',
            cancelWindowRemainingSeconds: remainingSeconds,
            cancelWindowEndsAtUtc: new Date(endsAtMs).toISOString()
        };
    }

    if (normalizedStatus === 'ON_GOING') {
        return {
            canCancelLalamove: true,
            cancelWindowMode: 'LIMITED',
            cancelWindowRemainingSeconds: null,
            cancelWindowEndsAtUtc: null
        };
    }

    const openUntilAssignedStatuses = new Set([
        '',
        'ASSIGNING_DRIVER',
        'PENDING',
        'FINDING_DRIVER'
    ]);
    if (openUntilAssignedStatuses.has(normalizedStatus)) {
        return {
            canCancelLalamove: true,
            cancelWindowMode: 'OPEN_UNTIL_ASSIGNED',
            cancelWindowRemainingSeconds: null,
            cancelWindowEndsAtUtc: null
        };
    }

    // Unknown status: allow attempt instead of blocking.
    // Lalamove will enforce policy and return ERR_CANCELLATION_FORBIDDEN when not allowed.
    return {
        canCancelLalamove: true,
        cancelWindowMode: 'OPEN_UNTIL_ASSIGNED',
        cancelWindowRemainingSeconds: null,
        cancelWindowEndsAtUtc: null
    };
};

const mapLalamoveUpdateToOrderStatus = ({ eventType, lalamoveStatus }) => {
    const normalizedEventType = String(eventType || '').toUpperCase();
    const normalizedStatus = String(lalamoveStatus || '').toUpperCase();

    if (normalizedStatus === 'ASSIGNING_DRIVER') return 'Finding Rider';
    if (normalizedStatus === 'ON_GOING') return 'Rider OTW';
    if (normalizedStatus === 'PICKED_UP') return 'Out For Delivery';
    if (normalizedStatus === 'COMPLETED') return 'Completed';
    // Merchant-initiated cancel (or Lalamove cancel after we cancel)
    if (['CANCELED', 'CANCELLED'].includes(normalizedStatus)) {
        return 'Cancelled';
    }
    // REJECTED / EXPIRED: Lalamove finished matching unsuccessfully.
    // Do NOT auto-cancel kitchen order — leave status for admin Retry dispatch or Cancel+refund.
    if (['REJECTED', 'EXPIRED'].includes(normalizedStatus)) {
        return null;
    }

    if (normalizedEventType === 'DRIVER_ASSIGNED') return 'Rider OTW';
    return null;
};

const readStopId = (stop) => String(stop?.stopId || stop?.id || '').trim() || null;

const resolveQuoteStops = (stops) => {
    const normalizedStops = Array.isArray(stops) ? stops : [];
    const senderStopId = readStopId(normalizedStops[0]);
    const recipientStopId = readStopId(normalizedStops[1]);
    return {
        senderStopId,
        recipientStopId
    };
};

const reserveDeliveryQuote = async (
    executor,
    { userId, quotationId, fee, currency, expiresAt, scheduledAtUtc, stops, metadata }
) => {
    const normalizedQuotationId = String(quotationId || '').trim();
    if (!normalizedQuotationId) {
        const error = new Error('Missing quotationId');
        error.status = 400;
        throw error;
    }
    const normalizedUserId = toPositiveInteger(userId);
    if (!normalizedUserId) {
        const error = new Error('Invalid user id for delivery quote');
        error.status = 400;
        throw error;
    }

    const feeMinorUnits = toMinorUnitsAllowZero(fee);
    if (feeMinorUnits === null) {
        const error = new Error('Invalid delivery fee');
        error.status = 400;
        throw error;
    }

    const normalizedCurrency = normalizeCurrencyCode(currency, 'MYR');
    const expiresAtSql = expiresAt ? toSqlDateTimeUtc(expiresAt) : null;
    const scheduledAtSql = scheduledAtUtc ? toSqlDateTimeUtc(scheduledAtUtc) : null;
    const { senderStopId, recipientStopId } = resolveQuoteStops(stops);
    const metadataJson = metadata ? JSON.stringify(metadata) : null;

    await executor.query(
        `
            INSERT INTO delivery_quotes (
                user_id,
                quotation_id,
                fee,
                currency,
                expires_at,
                scheduled_at_utc,
                sender_stop_id,
                recipient_stop_id,
                metadata_json,
                used_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
            ON DUPLICATE KEY UPDATE
                user_id = VALUES(user_id),
                fee = VALUES(fee),
                currency = VALUES(currency),
                expires_at = VALUES(expires_at),
                scheduled_at_utc = VALUES(scheduled_at_utc),
                sender_stop_id = VALUES(sender_stop_id),
                recipient_stop_id = VALUES(recipient_stop_id),
                metadata_json = VALUES(metadata_json),
                used_at = NULL
        `,
        [
            normalizedUserId,
            normalizedQuotationId,
            fromMinorUnits(feeMinorUnits),
            normalizedCurrency,
            expiresAtSql,
            scheduledAtSql,
            senderStopId,
            recipientStopId,
            metadataJson
        ]
    );
};

module.exports = {
    normalizeRemarkText,
    clampLalamoveRemark,
    buildLalamoveDefaultRemark,
    buildLalamoveRecipientRemark,
    isLalamoveInvalidQuotationError,
    extractLalamoveStopIds,
    formatScheduledAtLabel,
    computeLalamoveCancelState,
    mapLalamoveUpdateToOrderStatus,
    readStopId,
    resolveQuoteStops,
    reserveDeliveryQuote
};
