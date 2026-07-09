const crypto = require('crypto');
const db = require('../db');

const TIMEOUT_MS = 60_000;

// קורא ל-webhook החיצוני (Google Apps Script) שיוצר/משתף תיקיית Drive עבור ההזמנה.
// לא זורק לעולם — הקוראים (POST /api/orders, PATCH /api/admin/orders/:id) לא עוטפים
// את הקריאה הזו ב-try/catch משלהם.
async function triggerFulfillment(orderId) {
  try {
    const order = await db.getOrderForFulfillment(orderId);
    if (!order) {
      console.error(`[fulfillment] order not found: ${orderId}`);
      return { success: false, errorCode: 'ORDER_NOT_FOUND' };
    }

    const url = process.env.FULFILLMENT_WEBHOOK_URL;
    const secret = process.env.FULFILLMENT_WEBHOOK_SECRET;
    if (!url || !secret) {
      const errorMessage = 'FULFILLMENT_WEBHOOK_URL/FULFILLMENT_WEBHOOK_SECRET not configured';
      console.error(`[fulfillment] ${errorMessage}`);
      await db.recordFulfillmentFailure(orderId, {
        errorCode: 'CONFIG_MISSING', errorMessage, responseReceivedAt: new Date(),
      });
      return { success: false, errorCode: 'CONFIG_MISSING', errorMessage };
    }

    await db.recordFulfillmentAttempt(orderId, new Date());
    const requestId = crypto.randomUUID();
    const body = {
      secret,
      orderId,
      fileIds: order.fileIds,
      recipientEmail: order.recipientEmail,
      requestId,
      paymentType: order.paymentType,
      requestType: order.orderType,
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const data = await resp.json().catch(() => null);

      if (data && data.success) {
        await db.recordFulfillmentSuccess(orderId, {
          externalFolderUrl: data.externalFolderUrl,
          responseReceivedAt: new Date(),
        });
        return { success: true, externalFolderUrl: data.externalFolderUrl };
      }

      const errorCode = (data && data.errorCode) || `HTTP_${resp.status}`;
      const errorMessage = (data && data.errorMessage) || `Unexpected response (HTTP ${resp.status})`;
      console.error(`[fulfillment] order ${orderId} failed: ${errorCode} — ${errorMessage}`);
      await db.recordFulfillmentFailure(orderId, { errorCode, errorMessage, responseReceivedAt: new Date() });
      return { success: false, errorCode, errorMessage };
    } catch (err) {
      const errorCode = err.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR';
      console.error(`[fulfillment] order ${orderId} error: ${errorCode} — ${err.message}`);
      await db.recordFulfillmentFailure(orderId, { errorCode, errorMessage: err.message, responseReceivedAt: new Date() });
      return { success: false, errorCode, errorMessage: err.message };
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    console.error(`[fulfillment] unexpected error for order ${orderId}: ${err.message}`);
    return { success: false, errorCode: 'INTERNAL_ERROR', errorMessage: err.message };
  }
}

module.exports = { triggerFulfillment };
