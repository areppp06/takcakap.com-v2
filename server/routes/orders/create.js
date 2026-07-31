/**
 * Order routes: create.js
 */
'use strict';

const db = require('../../db');
const emailService = require('../../emailService');
const lalamoveService = require('../../lalamoveService');
const { PAYMENT_METHOD_CURLEC } = require('../../config');
const { requireAuth } = require('../../middleware/auth');
const {
    toNumber,
    toPositiveInteger,
    toSqlDateTimeUtc,
    isValidLatitude,
    isValidLongitude,
    roundCoordinate,
    normalizeCurrencyCode
} = require('../../lib/primitives');
const { fromMinorUnits, toMinorUnitsAllowZero } = require('../../lib/money');
const { emitOrdersChangedEvent } = require('../../services/orders/orderEvents');
const {
    buildLalamoveRecipientRemark,
    extractLalamoveStopIds,
    isLalamoveInvalidQuotationError,
    mapLalamoveUpdateToOrderStatus,
    reserveDeliveryQuote
} = require('../../services/lalamoveHelpers');
const { getNextOrderCode } = require('../../services/orders/orderCodes');
const {
    markCurlecCheckoutSessionConsumed,
    markCurlecCheckoutSessionStatus,
    normalizeCurlecCheckoutSessionId,
    reserveCurlecCheckoutSessionForFinalize,
    fetchOrderCreationProjectionByOrderId,
    fetchOrderCreationProjectionByPaymentId
} = require('../../services/curlec');
const { fetchDeliveryOptions, fetchPaymentOptions } = require('../../services/paymentOptions');
const { fetchShopStatus } = require('../../services/shop');
const { syncCartWithStock } = require('../../services/cartService');
const { recordOrderCreateEvent, startOrderCreateTimer } = require('../../observability');
const {
    aggregateRequestedItems,
    normalizeCreateOrderBasics,
    clientErrorBody,
    validateCurlecPaymentForCreate,
    assertDeliveryQuoteMatchesOrder
} = require('../../services/orders/createOrder');
const {
    formatDebtMessage,
    formatVoucherFrozenMessage,
    isVoucherUseBlockedByDebt
} = require('../../domain/pointsPolicy');

module.exports = function register(app) {

    app.post('/api/orders', requireAuth, async (req, res) => {
        const {
            total,
            items,
            orderType,
            address,
            addressSnapshot,
            quotationId,
            recipient,
            paymentMethod,
            curlecPayment,
            curlecCheckoutSessionId,
            deliveryTiming,
            scheduledAtUtc,
            voucherCode
        } = req.body;

        const basics = normalizeCreateOrderBasics({
            orderType,
            paymentMethod,
            total,
            deliveryTiming,
            scheduledAtUtc
        });
        if (!basics.ok) {
            return res.status(basics.status || 400).json({ error: basics.error });
        }
        const normalizedOrderType = basics.orderType;
        const normalizedPaymentMethod = basics.paymentMethod;
        const submittedTotal = basics.submittedTotal;
        const isLalamoveDelivery = basics.isLalamoveDelivery;
        const normalizedDeliveryTiming = basics.deliveryTiming;
        const scheduledAtSql = basics.scheduledAtSql;
        const scheduledAtUtcValue = basics.scheduledAtUtc;

        const normalizedCurlecCheckoutSessionId = normalizeCurlecCheckoutSessionId(curlecCheckoutSessionId);
        const stopOrderCreateTimer = startOrderCreateTimer({
            paymentMethod: normalizedPaymentMethod,
            orderType: normalizedOrderType
        });
        let orderCreateMetricsCompleted = false;
        let orderCreateDeliveryBookingStatus = 'na';
        const finalizeOrderCreateMetrics = (statusLabel) => {
            if (orderCreateMetricsCompleted) return;
            orderCreateMetricsCompleted = true;
            stopOrderCreateTimer({ status: statusLabel });
            recordOrderCreateEvent({
                status: statusLabel,
                paymentMethod: normalizedPaymentMethod,
                orderType: normalizedOrderType,
                deliveryBookingStatus: orderCreateDeliveryBookingStatus
            });
        };
        res.on('finish', () => {
            if (orderCreateMetricsCompleted) return;
            if (res.statusCode >= 200 && res.statusCode < 300) {
                finalizeOrderCreateMetrics('success');
                return;
            }
            if (res.statusCode >= 400 && res.statusCode < 500) {
                finalizeOrderCreateMetrics('client_error');
                return;
            }
            finalizeOrderCreateMetrics('server_error');
        });

        const initialStatus = 'Preparing';
        const resolvedUserId = req.user.id;
        const itemsAgg = aggregateRequestedItems(items);
        if (!itemsAgg.ok) {
            return res.status(400).json({ error: itemsAgg.error });
        }
        const orderItems = itemsAgg.orderItems;
        const requestedQuantityById = itemsAgg.map;

        let curlecPaymentProof = null;
        let paymentAmountInMinorUnits = null;
        let paymentOptions = null;
        try {
            paymentOptions = await fetchPaymentOptions(db);
            const paymentValidation = await validateCurlecPaymentForCreate({
                curlecPayment,
                paymentOptions
            });
            curlecPaymentProof = paymentValidation.curlecPaymentProof;
            paymentAmountInMinorUnits = paymentValidation.paymentAmountInMinorUnits;
        } catch (paymentError) {
            console.error('Payment validation failed:', paymentError?.payload || paymentError?.message || paymentError);
            return res.status(paymentError.status || 500).json(
                clientErrorBody(paymentError, 'Payment validation failed')
            );
        }

        let shopStatusAtOrder = null;
        try {
            shopStatusAtOrder = await fetchShopStatus(db);
            if (!shopStatusAtOrder.isOrderable) {
                return res.status(403).json({ error: shopStatusAtOrder.message, shopStatus: shopStatusAtOrder });
            }
        } catch (statusError) {
            console.error('Failed to check shop status before order:', statusError);
            return res.status(500).json({ error: 'Failed to validate shop availability' });
        }

        let connection = null;
        let hasTransaction = false;
        let orderId = null;
        let orderCode = null;
        let normalizedItems = [];
        let deliveryQuoteReservation = null;
        let totalAmountMinorUnits = 0;
        let persistedDeliveryFee = null;
        let persistedDeliveryCurrency = null;
        let persistedDeliveryAddress = '';
        let persistedDeliveryLatitude = null;
        let persistedDeliveryLongitude = null;
        let persistedRecipientName = '';
        let persistedRecipientRemarks = '';
        let persistedDeliveryContactPhone = '';
        let persistedUserDisplayName = 'Customer';
        let curlecSessionReservation = null;
        try {
            connection = await db.getConnection();
            const [userRows] = await connection.query(
                'SELECT name, phone_number FROM users WHERE id = ? LIMIT 1',
                [resolvedUserId]
            );
            const profileName = String(userRows[0]?.name || '').trim();
            const profilePhone = String(userRows[0]?.phone_number || '').trim();
            const snapshotLabel = String(addressSnapshot?.label || '').trim();
            const snapshotAddressLine = String(addressSnapshot?.addressLine || address || '').trim().slice(0, 200);
            const snapshotNote = String(addressSnapshot?.note || recipient?.remarks || '').trim().slice(0, 66);
            const rawSnapshotLatitude = toNumber(addressSnapshot?.latitude);
            const rawSnapshotLongitude = toNumber(addressSnapshot?.longitude);
            const snapshotLatitude = isValidLatitude(rawSnapshotLatitude) ? roundCoordinate(rawSnapshotLatitude) : null;
            const snapshotLongitude = isValidLongitude(rawSnapshotLongitude) ? roundCoordinate(rawSnapshotLongitude) : null;
            const snapshotRecipientName =
                String(recipient?.name || '').trim() || profileName || 'Customer';
            persistedUserDisplayName = profileName || snapshotRecipientName || 'Customer';
            persistedDeliveryLatitude = snapshotLatitude;
            persistedDeliveryLongitude = snapshotLongitude;
            let deliveryContactPhone = normalizedOrderType === 'Pickup' ? profilePhone : '';
            if (!profilePhone) {
                return res.status(400).json({
                    error: 'Phone number is required in your profile before placing an order'
                });
            }

            const deliveryOptions = await fetchDeliveryOptions(connection);
            if (normalizedOrderType === 'Pickup' && !deliveryOptions.pickupEnabled) {
                const error = new Error('Store Pickup is unavailable for now');
                error.status = 403;
                throw error;
            }
            if (normalizedOrderType === 'Delivery' && !deliveryOptions.lalamoveEnabled) {
                const error = new Error('Lalamove Delivery is unavailable for now');
                error.status = 403;
                throw error;
            }

            await connection.beginTransaction();
            hasTransaction = true;

            if (normalizedPaymentMethod === PAYMENT_METHOD_CURLEC && curlecPaymentProof?.paymentId) {
                if (normalizedCurlecCheckoutSessionId) {
                    curlecSessionReservation = await reserveCurlecCheckoutSessionForFinalize(connection, {
                        sessionId: normalizedCurlecCheckoutSessionId,
                        userId: resolvedUserId,
                        curlecOrderId: curlecPaymentProof.orderId,
                        paymentId: curlecPaymentProof.paymentId,
                        expectedAmountMinor: paymentAmountInMinorUnits
                    });
                    if (curlecSessionReservation?.alreadyConsumed && curlecSessionReservation?.consumedOrderId) {
                        const error = new Error('This Curlec checkout session has already been finalized');
                        error.status = 409;
                        error.code = 'CURLEC_CHECKOUT_ALREADY_CONSUMED';
                        error.existingOrderId = curlecSessionReservation.consumedOrderId;
                        throw error;
                    }
                }

                const [existingPaymentRows] = await connection.query(
                    `
                        SELECT id
                        FROM orders
                        WHERE curlec_payment_id = ?
                        LIMIT 1
                        FOR UPDATE
                    `,
                    [curlecPaymentProof.paymentId]
                );
                if (existingPaymentRows.length > 0) {
                    const error = new Error('This Curlec payment has already been used for an order');
                    error.status = 409;
                    error.code = 'CURLEC_PAYMENT_ALREADY_USED';
                    error.existingOrderId = toPositiveInteger(existingPaymentRows[0].id);
                    throw error;
                }
            }

            const menuItemIds = Array.from(requestedQuantityById.keys());
            const [menuRows] = await connection.query(
                `
                    SELECT m.id, m.name, m.stock, m.is_active, m.price, c.is_active as category_is_active
                    FROM menu_items m
                    LEFT JOIN categories c ON c.id = m.category_id
                    WHERE m.id IN (?)
                    FOR UPDATE
                `,
                [menuItemIds]
            );
            const menuById = new Map(menuRows.map((row) => [Number(row.id), row]));
            let subtotalMinorUnits = 0;
            normalizedItems = [];

            for (const [menuItemId, requestedQuantity] of requestedQuantityById.entries()) {
                const row = menuById.get(menuItemId);
                if (!row) {
                    const error = new Error(`Menu item ${menuItemId} not found`);
                    error.status = 404;
                    throw error;
                }
                const availableStock = Number(row.stock || 0);
                const isActive = Boolean(row.is_active) && (row.category_is_active === null || Boolean(row.category_is_active));
                if (!isActive || availableStock <= 0) {
                    const error = new Error(`${row.name} is out of stock`);
                    error.status = 400;
                    throw error;
                }
                if (requestedQuantity > availableStock) {
                    const error = new Error(`${row.name} only has ${availableStock} in stock`);
                    error.status = 400;
                    throw error;
                }

                const unitPriceMinorUnits = toMinorUnitsAllowZero(row.price);
                if (unitPriceMinorUnits === null) {
                    const error = new Error(`Invalid price for menu item ${row.name}`);
                    error.status = 500;
                    throw error;
                }

                subtotalMinorUnits += unitPriceMinorUnits * requestedQuantity;
                normalizedItems.push({
                    id: menuItemId,
                    quantity: requestedQuantity,
                    price: fromMinorUnits(unitPriceMinorUnits),
                    snapshotName: String(row.name || '').trim() || `Menu Item #${menuItemId}`
                });
            }

            const serviceFeeMinorUnits = toMinorUnitsAllowZero(paymentOptions?.serviceFee || 0) || 0;
            let deliveryFeeMinorUnits = 0;
            let quotationIdForOrder = null;
            let senderStopId = null;
            let recipientStopId = null;

            let appliedVoucherId = null;
            let appliedDiscountMinorUnits = 0;
            let appliedDiscountAmount = 0;

            if (voucherCode) {
                const [balRows] = await connection.query(
                    `SELECT points_balance FROM users WHERE id = ? FOR UPDATE`,
                    [resolvedUserId]
                );
                const pointsBalance = Number(balRows[0]?.points_balance || 0);
                if (isVoucherUseBlockedByDebt(pointsBalance)) {
                    const debtPoints = Math.abs(pointsBalance);
                    const err = new Error(
                        formatVoucherFrozenMessage(debtPoints) || formatDebtMessage(debtPoints)
                    );
                    err.status = 400;
                    err.code = 'POINTS_DEBT';
                    throw err;
                }

                const normalizedCode = String(voucherCode).trim().toUpperCase();
                const [voucherRows] = await connection.query(
                    `SELECT id, type, discount_value, min_spend, max_discount, expires_at, is_active, is_redeemed, max_uses, times_used, user_id
                     FROM vouchers WHERE code = ? FOR UPDATE`,
                    [normalizedCode]
                );
                const voucher = voucherRows[0];
                
                if (!voucher) {
                    const err = new Error('Invalid voucher code'); err.status = 400; throw err;
                }
                if (!voucher.is_active || voucher.times_used >= voucher.max_uses) {
                    const err = new Error('Voucher is no longer valid or has reached its usage limit'); err.status = 400; throw err;
                }
                if (new Date(voucher.expires_at) < new Date()) {
                    const err = new Error('Voucher has expired'); err.status = 400; throw err;
                }
                if (voucher.user_id && voucher.user_id !== resolvedUserId) {
                    const err = new Error('Voucher does not belong to your account'); err.status = 400; throw err;
                }
                
                const minSpendMinorUnits = toMinorUnitsAllowZero(voucher.min_spend) || 0;
                if (subtotalMinorUnits < minSpendMinorUnits) {
                    const err = new Error(`Minimum spend of RM${voucher.min_spend} required to use this voucher`); err.status = 400; throw err;
                }
                
                if (voucher.type === 'fixed') {
                    appliedDiscountMinorUnits = toMinorUnitsAllowZero(voucher.discount_value) || 0;
                } else if (voucher.type === 'percentage') {
                    appliedDiscountMinorUnits = Math.floor(subtotalMinorUnits * (Number(voucher.discount_value) / 100));
                    const maxDiscountMinorUnits = toMinorUnitsAllowZero(voucher.max_discount);
                    if (maxDiscountMinorUnits && appliedDiscountMinorUnits > maxDiscountMinorUnits) {
                        appliedDiscountMinorUnits = maxDiscountMinorUnits;
                    }
                }
                
                if (appliedDiscountMinorUnits > subtotalMinorUnits) {
                    appliedDiscountMinorUnits = subtotalMinorUnits;
                }
                
                appliedVoucherId = voucher.id;
                appliedDiscountAmount = fromMinorUnits(appliedDiscountMinorUnits);
            }

            if (isLalamoveDelivery) {
                const normalizedQuotationId = String(quotationId || '').trim();
                if (!normalizedQuotationId) {
                    const error = new Error('Missing Lalamove quotationId for delivery order');
                    error.status = 400;
                    throw error;
                }

                const [quoteRows] = await connection.query(
                    `
                        SELECT
                            id,
                            fee,
                            currency,
                            expires_at,
                            DATE_FORMAT(expires_at, '%Y-%m-%dT%H:%i:%sZ') AS expires_at_utc_iso,
                            scheduled_at_utc,
                            DATE_FORMAT(scheduled_at_utc, '%Y-%m-%d %H:%i:%s') AS scheduled_at_utc_sql,
                            sender_stop_id,
                            recipient_stop_id,
                            used_at
                        FROM delivery_quotes
                        WHERE quotation_id = ?
                          AND user_id = ?
                        LIMIT 1
                        FOR UPDATE
                    `,
                    [normalizedQuotationId, resolvedUserId]
                );
                const quote = quoteRows[0];
                if (!quote) {
                    const error = new Error('Delivery quotation not found. Please refresh delivery quote.');
                    error.status = 409;
                    throw error;
                }
                const quoteMatch = assertDeliveryQuoteMatchesOrder({
                    quote,
                    normalizedDeliveryTiming,
                    scheduledAtSql,
                    normalizedPaymentMethod
                });
                senderStopId = quoteMatch.senderStopId;
                recipientStopId = quoteMatch.recipientStopId;
                if (!senderStopId || !recipientStopId) {
                    const error = new Error('Delivery quote is missing stop information. Please request a new quote.');
                    error.status = 400;
                    throw error;
                }
                if (!snapshotAddressLine) {
                    const error = new Error('Delivery address is required');
                    error.status = 400;
                    throw error;
                }
                const normalizedRecipientPhone = lalamoveService.normalizePhone(
                    recipient?.phone || addressSnapshot?.phone || ''
                );
                if (!lalamoveService.isValidPhone(normalizedRecipientPhone)) {
                    const error = new Error('Recipient phone is required and must be valid, e.g. +60123456789');
                    error.status = 400;
                    throw error;
                }
                deliveryContactPhone = normalizedRecipientPhone;
                deliveryFeeMinorUnits = toMinorUnitsAllowZero(quote.fee) || 0;
                quotationIdForOrder = normalizedQuotationId;
                persistedDeliveryCurrency = normalizeCurrencyCode(quote.currency, 'MYR');
                deliveryQuoteReservation = {
                    id: toPositiveInteger(quote.id),
                    quotationId: normalizedQuotationId,
                    senderStopId,
                    recipientStopId,
                    needsRefresh: Boolean(quoteMatch.isQuoteExpired)
                };
            }

            totalAmountMinorUnits = subtotalMinorUnits + serviceFeeMinorUnits + deliveryFeeMinorUnits - appliedDiscountMinorUnits;
            if (totalAmountMinorUnits <= 0) {
                const error = new Error('Computed order total is invalid');
                error.status = 400;
                throw error;
            }
            const submittedMinorUnits = toMinorUnitsAllowZero(submittedTotal);
            if (submittedMinorUnits === null || Math.abs(submittedMinorUnits - totalAmountMinorUnits) > 1) {
                const error = new Error('Order total has changed. Please refresh and try again.');
                error.status = 409;
                error.expectedTotal = fromMinorUnits(totalAmountMinorUnits);
                throw error;
            }

            if (normalizedPaymentMethod === PAYMENT_METHOD_CURLEC) {
                if (!paymentAmountInMinorUnits || paymentAmountInMinorUnits !== totalAmountMinorUnits) {
                    const error = new Error(
                        `Curlec paid amount mismatch. Expected ${totalAmountMinorUnits}, got ${paymentAmountInMinorUnits || 0}`
                    );
                    error.status = 400;
                    throw error;
                }
            }

            const normalizedTotalAmount = fromMinorUnits(totalAmountMinorUnits);
            persistedDeliveryFee = isLalamoveDelivery ? fromMinorUnits(deliveryFeeMinorUnits) : null;
            persistedDeliveryAddress = normalizedOrderType === 'Delivery' ? snapshotAddressLine : address || '';
            persistedRecipientName = snapshotRecipientName || null;
            persistedRecipientRemarks = snapshotNote || '';
            persistedDeliveryContactPhone = deliveryContactPhone || null;

            // 0. Generate short_code sequentially
            const [lastOrderRows] = await connection.query(
                `SELECT short_code FROM orders ORDER BY id DESC LIMIT 1 FOR UPDATE`
            );
            const lastCode = lastOrderRows[0]?.short_code || null;
            orderCode = getNextOrderCode(lastCode);

            // 1. Create Order
            const [orderResult] = await connection.query(
                `INSERT INTO orders (
                    user_id,
                    status,
                    total_amount,
                    order_type,
                    delivery_address,
                    delivery_label_snapshot,
                    delivery_note_snapshot,
                    delivery_latitude,
                    delivery_longitude,
                    recipient_name_snapshot,
                    delivery_provider,
                    external_order_id,
                    quotation_id,
                    tracking_url,
                    driver_id,
                    lalamove_status,
                    payment_method,
                    curlec_order_id,
                    curlec_payment_id,
                    delivery_fee,
                    delivery_currency,
                    delivery_timing,
                    scheduled_at_utc,
                    lalamove_ongoing_at,
                    delivery_contact_phone,
                    short_code,
                    voucher_id,
                    discount_amount,
                    delivery_booking_status,
                    delivery_booking_attempts,
                    delivery_last_attempt_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    resolvedUserId,
                    initialStatus,
                    normalizedTotalAmount,
                    normalizedOrderType,
                    persistedDeliveryAddress,
                    snapshotLabel || null,
                    snapshotNote || null,
                    snapshotLatitude,
                    snapshotLongitude,
                    persistedRecipientName || null,
                    'Internal',
                    null,
                    quotationIdForOrder,
                    null,
                    null,
                    null,
                    normalizedPaymentMethod,
                    normalizedPaymentMethod === PAYMENT_METHOD_CURLEC ? curlecPaymentProof?.orderId || null : null,
                    normalizedPaymentMethod === PAYMENT_METHOD_CURLEC ? curlecPaymentProof?.paymentId || null : null,
                    persistedDeliveryFee,
                    persistedDeliveryCurrency,
                    normalizedDeliveryTiming,
                    scheduledAtSql,
                    null,
                    persistedDeliveryContactPhone,
                    orderCode,
                    appliedVoucherId,
                    appliedDiscountAmount,
                    isLalamoveDelivery ? 'pending' : 'not_required',
                    0,
                    null
                ]
            );
            orderId = orderResult.insertId;

            // 2. Create Order Items
            for (const item of normalizedItems) {
                await connection.query(
                    `INSERT INTO order_items (order_id, menu_item_id, item_name_snapshot, quantity, unit_price) VALUES (?, ?, ?, ?, ?)`,
                    [orderId, item.id, item.snapshotName, item.quantity, item.price]
                );
            }

            // 3. Deduct stock (atomic non-negative guard)
            for (const [menuItemId, requestedQuantity] of requestedQuantityById.entries()) {
                const [stockResult] = await connection.query(
                    'UPDATE menu_items SET stock = stock - ? WHERE id = ? AND stock >= ?',
                    [requestedQuantity, menuItemId, requestedQuantity]
                );
                if (stockResult?.affectedRows !== 1) {
                    const error = new Error('One or more items ran out of stock while placing your order');
                    error.status = 409;
                    throw error;
                }
            }

            if (deliveryQuoteReservation?.id) {
                const [quoteUsageResult] = await connection.query(
                    `
                        UPDATE delivery_quotes
                        SET used_at = UTC_TIMESTAMP()
                        WHERE id = ?
                          AND used_at IS NULL
                    `,
                    [deliveryQuoteReservation.id]
                );
                if (quoteUsageResult?.affectedRows !== 1) {
                    const error = new Error('Delivery quotation already used. Please request a new quote.');
                    error.status = 409;
                    throw error;
                }
            }

            // 4. Keep carts synced with latest stock
            await syncCartWithStock(connection);

            if (
                normalizedPaymentMethod === PAYMENT_METHOD_CURLEC &&
                normalizedCurlecCheckoutSessionId &&
                curlecPaymentProof?.paymentId &&
                orderId
            ) {
                await markCurlecCheckoutSessionConsumed(connection, {
                    sessionId: normalizedCurlecCheckoutSessionId,
                    orderId,
                    paymentId: curlecPaymentProof.paymentId,
                    status: 'consumed'
                });
            }

            if (appliedVoucherId) {
                await connection.query(
                    `UPDATE vouchers SET times_used = times_used + 1, is_redeemed = IF(times_used + 1 >= max_uses, TRUE, FALSE) WHERE id = ?`,
                    [appliedVoucherId]
                );
            }

            await connection.commit();
            hasTransaction = false;
            emitOrdersChangedEvent({
                source: 'order_create',
                orderId,
                reason: 'created'
            });
        } catch (err) {
            if (hasTransaction && connection) {
                await connection.rollback();
            }

            if (normalizedPaymentMethod === PAYMENT_METHOD_CURLEC) {
                try {
                    if (
                        (err.code === 'CURLEC_CHECKOUT_ALREADY_CONSUMED' || err.code === 'CURLEC_PAYMENT_ALREADY_USED') &&
                        err.existingOrderId
                    ) {
                        const [existingRows] = await db.query(
                            `
                                SELECT curlec_payment_id
                                FROM orders
                                WHERE id = ?
                                LIMIT 1
                            `,
                            [err.existingOrderId]
                        );
                        const existingPaymentId = String(existingRows[0]?.curlec_payment_id || '').trim();
                        const projection =
                            (existingPaymentId
                                ? await fetchOrderCreationProjectionByPaymentId(existingPaymentId)
                                : null) || (await fetchOrderCreationProjectionByOrderId(err.existingOrderId));
                        if (projection) {
                            await markCurlecCheckoutSessionStatus({
                                sessionId: normalizedCurlecCheckoutSessionId,
                                status: 'consumed',
                                paymentId: existingPaymentId || curlecPaymentProof?.paymentId || null,
                                consumedOrderId: projection.orderId
                            }).catch(() => null);
                            return res.status(200).json(projection);
                        }
                    }

                    if (
                        (err.code === 'CURLEC_PAYMENT_ALREADY_USED' || err.code === 'ER_DUP_ENTRY') &&
                        curlecPaymentProof?.paymentId
                    ) {
                        const projection = await fetchOrderCreationProjectionByPaymentId(curlecPaymentProof.paymentId);
                        if (projection) {
                            await markCurlecCheckoutSessionStatus({
                                sessionId: normalizedCurlecCheckoutSessionId,
                                status: 'consumed',
                                paymentId: curlecPaymentProof.paymentId,
                                consumedOrderId: projection.orderId
                            }).catch(() => null);
                            return res.status(200).json(projection);
                        }
                    }
                } catch (lookupError) {
                    console.error('Failed to fetch existing order for duplicate Curlec payment:', lookupError);
                }
            }

            console.error(err?.payload || err?.message || err);
            return res.status(err.status || 500).json({
                ...clientErrorBody(err, 'Order creation failed'),
                expectedTotal: err.expectedTotal ?? undefined
            });
        } finally {
            if (connection) {
                connection.release();
            }
        }

        let lalamoveOrder = null;
        let deliveryBookingStatus = null;
        let deliveryBookingMessage = null;
        if (isLalamoveDelivery && orderId && deliveryQuoteReservation) {
            const refreshDeliveryQuoteReservation = async () => {
                if (!persistedDeliveryAddress || persistedDeliveryLatitude === null || persistedDeliveryLongitude === null) {
                    const error = new Error('Delivery quote refresh requires a valid address and coordinates');
                    error.status = 409;
                    throw error;
                }
                const refreshedQuotation = await lalamoveService.createQuotation({
                    dropoffAddress: persistedDeliveryAddress,
                    dropoffLat: persistedDeliveryLatitude,
                    dropoffLng: persistedDeliveryLongitude,
                    dropoffNote: persistedRecipientRemarks || '',
                    scheduleAt: scheduledAtUtcValue || undefined,
                    store: {
                        name: shopStatusAtOrder?.storeName,
                        phone: shopStatusAtOrder?.storePhone,
                        address: shopStatusAtOrder?.storeAddress,
                        latitude: shopStatusAtOrder?.storeLatitude,
                        longitude: shopStatusAtOrder?.storeLongitude
                    }
                });
                const refreshedQuotationId = String(refreshedQuotation?.quotationId || '').trim();
                if (!refreshedQuotationId) {
                    const error = new Error('Unable to refresh delivery quotation');
                    error.status = 502;
                    throw error;
                }
                const refreshedStops = refreshedQuotation?.stops || [];
                const { senderStopId, recipientStopId } = extractLalamoveStopIds(refreshedStops);
                if (!senderStopId || !recipientStopId) {
                    const error = new Error('Refreshed delivery quote is missing stop information');
                    error.status = 502;
                    throw error;
                }

                const refreshedQuoteFee = toNumber(refreshedQuotation?.priceBreakdown?.total) ?? persistedDeliveryFee ?? 0;
                const refreshedQuoteCurrency = normalizeCurrencyCode(
                    refreshedQuotation?.priceBreakdown?.currency,
                    persistedDeliveryCurrency || 'MYR'
                );

                await reserveDeliveryQuote(db, {
                    userId: resolvedUserId,
                    quotationId: refreshedQuotationId,
                    fee: refreshedQuoteFee,
                    currency: refreshedQuoteCurrency,
                    expiresAt: refreshedQuotation?.expiresAt || null,
                    scheduledAtUtc: scheduledAtUtcValue || null,
                    stops: refreshedStops,
                    metadata: {
                        addressLine: persistedDeliveryAddress,
                        latitude: persistedDeliveryLatitude,
                        longitude: persistedDeliveryLongitude,
                        recipientName: persistedRecipientName || 'Customer',
                        recipientPhone: persistedDeliveryContactPhone || '',
                        note: persistedRecipientRemarks || ''
                    }
                }).catch((quotePersistError) => {
                    console.warn(
                        `Failed to persist refreshed quotation ${refreshedQuotationId} for order ${orderId}:`,
                        quotePersistError?.message || quotePersistError
                    );
                });

                return {
                    ...deliveryQuoteReservation,
                    quotationId: refreshedQuotationId,
                    senderStopId,
                    recipientStopId,
                    needsRefresh: false,
                    refreshed: true
                };
            };

            let dispatchReservation = deliveryQuoteReservation;
            let didRefreshQuote = false;
            try {
                const createLalamoveDispatchOrder = async () =>
                    lalamoveService.createOrder({
                        quotationId: dispatchReservation.quotationId,
                        senderStopId: dispatchReservation.senderStopId,
                        recipientStopId: dispatchReservation.recipientStopId,
                        recipientName: persistedRecipientName || 'Customer',
                        recipientPhone: persistedDeliveryContactPhone,
                        recipientRemarks: buildLalamoveRecipientRemark({
                            shortCode: orderCode,
                            userName: persistedUserDisplayName || persistedRecipientName || 'Customer',
                            customerRemark: persistedRecipientRemarks || ''
                        }),
                        store: {
                            name: shopStatusAtOrder?.storeName,
                            phone: shopStatusAtOrder?.storePhone,
                            address: shopStatusAtOrder?.storeAddress,
                            latitude: shopStatusAtOrder?.storeLatitude,
                            longitude: shopStatusAtOrder?.storeLongitude
                        },
                        metadata: {
                            source: 'takcakap',
                            localOrderRef: `fd-${orderId}`
                        }
                    });

                if (dispatchReservation?.needsRefresh) {
                    dispatchReservation = await refreshDeliveryQuoteReservation();
                    didRefreshQuote = true;
                }

                try {
                    lalamoveOrder = await createLalamoveDispatchOrder();
                } catch (initialDispatchError) {
                    if (!didRefreshQuote && isLalamoveInvalidQuotationError(initialDispatchError)) {
                        dispatchReservation = await refreshDeliveryQuoteReservation();
                        didRefreshQuote = true;
                        lalamoveOrder = await createLalamoveDispatchOrder();
                    } else {
                        throw initialDispatchError;
                    }
                }

                const mappedStatus =
                    mapLalamoveUpdateToOrderStatus({
                        eventType: 'ORDER_CREATED',
                        lalamoveStatus: lalamoveOrder?.status || ''
                    }) || 'Finding Rider';
                const normalizedLalamoveStatus = String(lalamoveOrder?.status || '').trim() || 'ASSIGNING_DRIVER';
                const ongoingAtSql =
                    String(normalizedLalamoveStatus).toUpperCase() === 'ON_GOING'
                        ? toSqlDateTimeUtc(new Date())
                        : null;

                const [dispatchPersistResult] = await db.query(
                    `
                        UPDATE orders
                        SET
                            quotation_id = COALESCE(?, quotation_id),
                            delivery_provider = 'Lalamove',
                            external_order_id = ?,
                            tracking_url = ?,
                            driver_id = ?,
                            lalamove_status = ?,
                            status = CASE WHEN status = 'Cancelled' THEN status ELSE ? END,
                            lalamove_ongoing_at = CASE
                                WHEN ? IS NULL THEN lalamove_ongoing_at
                                ELSE COALESCE(lalamove_ongoing_at, ?)
                            END,
                            delivery_booking_status = 'booked',
                            delivery_booking_error = NULL,
                            delivery_booking_attempts = delivery_booking_attempts + 1,
                            delivery_last_attempt_at = UTC_TIMESTAMP()
                        WHERE id = ?
                          AND status <> 'Cancelled'
                    `,
                    [
                        didRefreshQuote ? dispatchReservation.quotationId : null,
                        lalamoveOrder?.orderId || null,
                        lalamoveOrder?.shareLink || null,
                        lalamoveOrder?.driverId || null,
                        normalizedLalamoveStatus,
                        mappedStatus,
                        ongoingAtSql,
                        ongoingAtSql,
                        orderId
                    ]
                );
                if (dispatchPersistResult?.affectedRows !== 1) {
                    deliveryBookingStatus = 'cancelled_before_dispatch_commit';
                    deliveryBookingMessage = 'Order was cancelled before delivery booking completed.';
                    if (lalamoveOrder?.orderId) {
                        await lalamoveService.cancelOrder(String(lalamoveOrder.orderId)).catch((cancelError) => {
                            console.warn(
                                `Failed to cancel orphaned Lalamove order ${lalamoveOrder.orderId} after local cancellation:`,
                                cancelError?.payload || cancelError?.message || cancelError
                            );
                        });
                    }
                    emitOrdersChangedEvent({
                        source: 'order_dispatch',
                        orderId,
                        reason: 'lalamove_aborted_cancelled'
                    });
                    lalamoveOrder = null;
                } else if (didRefreshQuote && dispatchReservation?.quotationId) {
                    await db
                        .query(
                            `
                                UPDATE delivery_quotes
                                SET used_at = COALESCE(used_at, UTC_TIMESTAMP())
                                WHERE quotation_id = ?
                                  AND user_id = ?
                                LIMIT 1
                            `,
                            [dispatchReservation.quotationId, resolvedUserId]
                        )
                        .catch(() => null);
                    emitOrdersChangedEvent({
                        source: 'order_dispatch',
                        orderId,
                        reason: 'lalamove_booked'
                    });
                    deliveryBookingStatus = 'booked';
                } else if (dispatchPersistResult?.affectedRows === 1) {
                    emitOrdersChangedEvent({
                        source: 'order_dispatch',
                        orderId,
                        reason: 'lalamove_booked'
                    });
                    deliveryBookingStatus = 'booked';
                }
            } catch (dispatchError) {
                const errorCode =
                    dispatchError?.payload?.errors?.[0]?.id ||
                    dispatchError?.code ||
                    dispatchError?.status ||
                    'DISPATCH_FAILED';
                const errorMessage =
                    dispatchError?.message ||
                    dispatchError?.payload?.errors?.[0]?.message ||
                    'Lalamove booking failed';
                deliveryBookingStatus = 'booking_failed';
                deliveryBookingMessage = errorMessage;
                console.error(
                    `Lalamove dispatch failed for order ${orderId}:`,
                    JSON.stringify(dispatchError?.payload || dispatchError?.message || dispatchError)
                );
                await db
                    .query(
                        `
                            UPDATE orders
                            SET
                                lalamove_status = 'BOOKING_FAILED',
                                delivery_booking_status = 'booking_failed',
                                delivery_booking_error = ?,
                                delivery_booking_attempts = delivery_booking_attempts + 1,
                                delivery_last_attempt_at = UTC_TIMESTAMP()
                            WHERE id = ?
                              AND external_order_id IS NULL
                        `,
                        [String(`${errorCode}: ${errorMessage}`).slice(0, 500), orderId]
                    )
                    .catch(() => null);

                emitOrdersChangedEvent({
                    source: 'order_dispatch',
                    orderId,
                    reason: 'delivery_booking_failed'
                });
            }
        }
        orderCreateDeliveryBookingStatus = deliveryBookingStatus || 'na';
        const responseLalamoveStatus =
            lalamoveOrder?.status ||
            (deliveryBookingStatus === 'cancelled_before_dispatch_commit'
                ? null
                : isLalamoveDelivery
                    ? 'BOOKING_FAILED'
                    : null);

        emailService.queueOrderEventEmail(orderId, 'payment_success');
        return res.json({
            success: true,
            orderId: orderId.toString(),
            shortCode: orderCode,
            externalOrderId: lalamoveOrder?.orderId || null,
            trackingUrl: lalamoveOrder?.shareLink || null,
            lalamoveStatus: responseLalamoveStatus,
            deliveryTiming: normalizedDeliveryTiming,
            scheduledAtUtc: scheduledAtUtcValue || null,
            total: fromMinorUnits(totalAmountMinorUnits),
            deliveryFee: persistedDeliveryFee,
            deliveryCurrency: persistedDeliveryCurrency,
            deliveryBookingStatus,
            deliveryBookingMessage
        });
    });

};
