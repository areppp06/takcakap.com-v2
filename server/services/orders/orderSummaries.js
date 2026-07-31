/**
 * Order line-item summary helpers for list endpoints.
 */
'use strict';

const db = require('../../db');
const { toPositiveInteger } = require('../../lib/primitives');

async function fetchOrderSummariesByOrderIds(orderIds, executor = db) {
    if (!Array.isArray(orderIds) || orderIds.length === 0) return new Map();
    const normalizedIds = orderIds
        .map((id) => toPositiveInteger(id))
        .filter((id) => id !== null);
    if (!normalizedIds.length) return new Map();

    const [summaryRows] = await executor.query(
        `
            SELECT
                oi.order_id,
                GROUP_CONCAT(
                    CONCAT(
                        oi.quantity,
                        'x ',
                        COALESCE(NULLIF(TRIM(oi.item_name_snapshot), ''), m.name, CONCAT('Menu Item #', oi.menu_item_id))
                    )
                    ORDER BY oi.id
                    SEPARATOR ', '
                ) AS items_summary
            FROM order_items oi
            LEFT JOIN menu_items m ON oi.menu_item_id = m.id
            WHERE oi.order_id IN (?)
            GROUP BY oi.order_id
        `,
        [normalizedIds]
    );

    const summaryMap = new Map();
    for (const row of summaryRows) {
        const orderId = toPositiveInteger(row.order_id);
        if (!orderId) continue;
        summaryMap.set(orderId, String(row.items_summary || '').trim());
    }
    return summaryMap;
}

module.exports = {
    fetchOrderSummariesByOrderIds
};
