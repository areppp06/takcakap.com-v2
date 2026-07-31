/**
 * Order routes: receipt PDF
 */
'use strict';

const PDFDocument = require('pdfkit');
const db = require('../../db');
const { DEFAULT_BRAND_LOGO_URL, PAYMENT_METHOD_CURLEC, SHOP_TIMEZONE } = require('../../config');
const { requireAuth } = require('../../middleware/auth');
const { toPositiveInteger, formatMoneyMYR } = require('../../lib/primitives');
const { fetchImageBuffer } = require('../../services/orders/orderEvents');

module.exports = function register(app) {


    app.get('/api/orders/:id/receipt', requireAuth, async (req, res) => {
        try {
            const orderId = toPositiveInteger(req.params.id);
            if (!orderId) {
                return res.status(400).json({ error: 'Invalid order id' });
            }

            const [orderRows] = await db.query(
                `
                    SELECT
                        o.id,
                        o.short_code,
                        o.user_id,
                        o.status,
                        o.total_amount,
                        o.created_at,
                        o.order_type,
                        o.delivery_address,
                        o.delivery_provider,
                        o.delivery_fee,
                        o.delivery_currency,
                        o.payment_method,
                        u.name AS customer_name,
                        u.email AS customer_email,
                        u.phone_number AS customer_phone,
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
            // Same 404 for not-owned (non-admin) as not-found — no existence oracle.
            if (
                !order ||
                (req.user.role !== 'admin' && Number(order.user_id) !== Number(req.user.id))
            ) {
                return res.status(404).json({ error: 'Order not found' });
            }

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

            const items = itemRows.map((row) => ({
                name: String(row.item_name_snapshot || row.menu_name || `Menu Item #${row.menu_item_id}`),
                quantity: Number(row.quantity || 0),
                unitPrice: Number(row.unit_price || 0),
                lineTotal: Number(row.quantity || 0) * Number(row.unit_price || 0)
            }));
            const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
            const deliveryFee = Number(order.delivery_fee || 0);
            const total = Number(order.total_amount || 0);
            const serviceFee = Math.max(total - subtotal - deliveryFee, 0);

            const createdAtText = new Date(order.created_at).toLocaleString('en-MY', {
                timeZone: SHOP_TIMEZONE,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                hour12: false
            });
            const paymentMethodLabel = String(order.payment_method || PAYMENT_METHOD_CURLEC).trim() || PAYMENT_METHOD_CURLEC;
            const receiptNumber = order.short_code || `FD-${String(order.id).padStart(6, '0')}`;
            const logoBuffer = await fetchImageBuffer(DEFAULT_BRAND_LOGO_URL);

            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="receipt-${order.id}.pdf"`);

            const doc = new PDFDocument({ margin: 28, size: 'A5' });
            doc.on('error', (pdfError) => {
                console.error('Receipt PDF generation failed:', pdfError);
                if (!res.headersSent) {
                    res.status(500).json({ error: 'Failed to generate receipt PDF' });
                }
            });
            doc.pipe(res);

            const left = doc.page.margins.left;
            const top = doc.page.margins.top;
            const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
            const pageBottom = doc.page.height - doc.page.margins.bottom;
            let y = top;

            // Header block
            doc.roundedRect(left, y, contentWidth, 86, 10).fill('#fff7fe');
            if (logoBuffer) {
                doc.image(logoBuffer, left + 12, y + 16, { fit: [78, 36], align: 'left' });
            }
            const titleX = logoBuffer ? left + 100 : left + 14;
            doc.fillColor('#111111').font('Helvetica-Bold').fontSize(18).text('ORDER RECEIPT', titleX, y + 16);
            doc.fillColor('#666666').font('Helvetica').fontSize(10).text('TakCakap Malaysia', titleX, y + 38);
            doc.fillColor('#9d2d8f').font('Helvetica-Bold').fontSize(9).text(receiptNumber, titleX, y + 56);
            y += 100;

            // Receipt info card (single-column label/value pairs for stable alignment on A5)
            const infoRows = [
                ['Receipt No', receiptNumber],
                ['Order ID', String(order.id)],
                ['Date', createdAtText],
                ['Status', String(order.status)],
                ['Order Type', String(order.order_type)],
                ['Payment', paymentMethodLabel]
            ];
            const infoRowHeight = 14;
            const infoCardHeight = 16 + infoRows.length * infoRowHeight + 8;
            const labelX = left + 12;
            const valueX = left + 126;
            const valueWidth = contentWidth - (valueX - left) - 12;

            doc.roundedRect(left, y, contentWidth, infoCardHeight, 10).fill('#fafafa');
            let infoY = y + 12;
            infoRows.forEach(([label, value]) => {
                doc.fillColor('#7a7a7a').font('Helvetica-Bold').fontSize(8).text(label.toUpperCase(), labelX, infoY);
                doc.fillColor('#111111').font('Helvetica').fontSize(10).text(value, valueX, infoY - 1, {
                    width: valueWidth,
                    align: 'right',
                    ellipsis: true
                });
                infoY += infoRowHeight;
            });
            y += infoCardHeight + 14;

            // Customer
            doc.fillColor('#111111').font('Helvetica-Bold').fontSize(10).text('Customer', left, y);
            y += 14;
            doc.font('Helvetica').fontSize(10).fillColor('#222222').text(order.customer_name || 'Guest', left, y);
            y += 14;
            if (order.customer_email) {
                doc.fillColor('#444444').fontSize(9).text(order.customer_email, left, y);
                y += 12;
            }
            if (order.customer_phone) {
                doc.fillColor('#444444').fontSize(9).text(order.customer_phone, left, y);
                y += 12;
            }
            y += 8;

            // Items table header
            doc.fillColor('#7a7a7a').font('Helvetica-Bold').fontSize(8);
            doc.text('ITEM', left, y, { width: contentWidth - 125 });
            doc.text('QTY', left + contentWidth - 122, y, { width: 26, align: 'right' });
            doc.text('PRICE', left + contentWidth - 94, y, { width: 42, align: 'right' });
            doc.text('TOTAL', left + contentWidth - 48, y, { width: 48, align: 'right' });
            y += 12;
            doc.moveTo(left, y).lineTo(left + contentWidth, y).strokeColor('#e6e6e6').lineWidth(1).stroke();
            y += 8;

            doc.font('Helvetica').fontSize(9).fillColor('#111111');
            if (!items.length) {
                doc.text('No items found for this order.', left, y);
                y += 16;
            } else {
                items.forEach((item) => {
                    if (y > pageBottom - 130) {
                        doc.addPage({ size: 'A5', margin: 28 });
                        y = doc.page.margins.top;
                    }
                    const itemNameHeight = doc.heightOfString(item.name, {
                        width: contentWidth - 125
                    });
                    const rowHeight = Math.max(12, itemNameHeight) + 4;
                    doc.text(item.name, left, y, { width: contentWidth - 125 });
                    doc.text(String(item.quantity), left + contentWidth - 122, y, { width: 26, align: 'right' });
                    doc.text(formatMoneyMYR(item.unitPrice), left + contentWidth - 94, y, { width: 42, align: 'right' });
                    doc.text(formatMoneyMYR(item.lineTotal), left + contentWidth - 48, y, { width: 48, align: 'right' });
                    y += rowHeight;
                });
            }

            y += 8;
            if (y > pageBottom - 150) {
                doc.addPage({ size: 'A5', margin: 28 });
                y = doc.page.margins.top;
            }

            // Totals block
            const hasVoucher = order.voucher_code && Number(order.voucher_discount) > 0;
            let totalBlockHeight = order.order_type === 'Delivery' ? 74 : 58;
            if (hasVoucher) totalBlockHeight += 14;

            doc.roundedRect(left + contentWidth - 190, y, 190, totalBlockHeight, 10).fill('#f7f7f7');
            let ty = y + 10;
            doc.fillColor('#666666').font('Helvetica').fontSize(9);
            doc.text('Subtotal', left + contentWidth - 178, ty);
            doc.text(formatMoneyMYR(subtotal), left + contentWidth - 92, ty, { width: 82, align: 'right' });
            ty += 14;
            doc.text('Service Fee', left + contentWidth - 178, ty);
            doc.text(formatMoneyMYR(serviceFee), left + contentWidth - 92, ty, { width: 82, align: 'right' });
            ty += 14;
            if (order.order_type === 'Delivery') {
                doc.text('Delivery Fee', left + contentWidth - 178, ty);
                doc.text(formatMoneyMYR(deliveryFee), left + contentWidth - 92, ty, { width: 82, align: 'right' });
                ty += 14;
            }
            if (hasVoucher) {
                doc.text(`Voucher (${order.voucher_code})`, left + contentWidth - 178, ty);
                doc.fillColor('#059669').text(`-${formatMoneyMYR(Number(order.voucher_discount))}`, left + contentWidth - 92, ty, { width: 82, align: 'right' });
                doc.fillColor('#666666'); // Reset color
                ty += 14;
            }
            doc.font('Helvetica-Bold').fillColor('#111111');
            doc.text('Grand Total', left + contentWidth - 178, ty);
            doc.text(formatMoneyMYR(total), left + contentWidth - 92, ty, { width: 82, align: 'right' });
            y += totalBlockHeight + 10;

            if (order.order_type === 'Delivery' && order.delivery_address) {
                if (y > pageBottom - 90) {
                    doc.addPage({ size: 'A5', margin: 28 });
                    y = doc.page.margins.top;
                }
                doc.fillColor('#111111').font('Helvetica-Bold').fontSize(10).text('Delivery Address', left, y);
                y += 14;
                doc.font('Helvetica').fontSize(9).fillColor('#444444').text(String(order.delivery_address), left, y, {
                    width: contentWidth
                });
            }

            // Footer
            const footerY = doc.page.height - doc.page.margins.bottom - 24;
            doc.moveTo(left, footerY).lineTo(left + contentWidth, footerY).strokeColor('#ececec').lineWidth(1).stroke();
            doc.fillColor('#777777').font('Helvetica').fontSize(8).text(
                'This is a computer-generated receipt. Thank you for supporting TakCakap.',
                left,
                footerY + 6,
                { width: contentWidth, align: 'center' }
            );

            doc.end();
        } catch (err) {
            console.error('Receipt endpoint failed:', err);
            return res.status(500).json({ error: 'Failed to generate receipt' });
        }
    });

};
