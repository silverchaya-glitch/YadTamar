const express = require('express');
const router = express.Router();
const db = require('../db');
const paymentService = require('../services/payment');
const { triggerFulfillment } = require('../services/fulfillment');
const { sendPurchaseConfirmation, sendFileDelivery, sendPaymentApprovedOfficeNotification, sendPaymentFailedOfficeNotification } = require('../services/email');

const UUID_RE = /^[0-9a-f-]{36}$/i;

// לוגיקת ה-side-effects אחרי שסטטוס תשלום נקבע (APPROVED/FAILED) — משותפת
// ל-/webhook האמיתי ול-/mock-confirm (סימולציה, ראה למטה), כדי לא לשכפל אותה.
async function finalizePaymentResult(orderId, status) {
  if (status === 'APPROVED') {
    const fulfillment = await triggerFulfillment(orderId);
    const order = await db.getOrderForPayment(orderId);
    if (order) {
      await sendPurchaseConfirmation({
        orderId: order.id,
        customerId: order.customerId,
        orderNumber: order.orderNumber,
        customerName: order.customerName,
        email: order.email,
        total: order.totalAmount,
        deliveryType: order.deliveryType,
      });
      // מייל "התוכן שלך מוכן" עם קישור התיקייה האמיתי — רק כשהשיתוף בפועל הושלם
      // (sharingStatus 'SHARED'), דרך האתר (לא דרך share-lib.gs, שכבר לא שולח מיילים).
      if (fulfillment.success && fulfillment.sharingStatus === 'SHARED' && fulfillment.externalFolderUrl) {
        await sendFileDelivery({
          orderId: order.id,
          customerId: order.customerId,
          customerName: order.customerName,
          email: order.email,
          folderUrl: fulfillment.externalFolderUrl,
        });
      }
      await sendPaymentApprovedOfficeNotification({
        orderId: order.id,
        customerId: order.customerId,
        orderNumber: order.orderNumber,
        customerName: order.customerName,
        phone: order.phone,
        email: order.email,
        paymentType: order.paymentType,
        deliveryType: order.deliveryType,
        totalAmount: order.totalAmount,
        fulfillment,
      });
    }
    console.log(`[payment] order ${orderId} approved, fulfillment: ${fulfillment.success ? fulfillment.sharingStatus : 'FAILED — ' + fulfillment.errorCode}`);
  } else {
    const order = await db.getOrderForPayment(orderId);
    if (order) {
      await sendPaymentFailedOfficeNotification({
        orderId: order.id,
        customerId: order.customerId,
        orderNumber: order.orderNumber,
        customerName: order.customerName,
        phone: order.phone,
        email: order.email,
        paymentType: order.paymentType,
        deliveryType: order.deliveryType,
        totalAmount: order.totalAmount,
      });
    } else {
      console.error(`[payment] payment failed for unknown order ${orderId} — could not send office notification`);
    }
  }
}

// POST /api/payment/:orderId/init — פותח עסקת תשלום מול HYP ומחזיר redirectUrl
// לדף התשלום המאובטח שלהם. נקרא מ-index.html מיד אחרי POST /api/orders להזמנת
// CREDIT_CARD (ראה server/routes/orders.js — triggerFulfillment לא נקרא שם עבור
// CREDIT_CARD בכלל; זה קורה רק מה-webhook למטה, אחרי אישור תשלום אמיתי).
router.post('/:orderId/init', async (req, res) => {
  try {
    const { orderId } = req.params;
    if (!UUID_RE.test(orderId)) return res.status(400).json({ error: 'orderId לא תקין' });

    const order = await db.getOrderForPayment(orderId);
    if (!order) return res.status(404).json({ error: 'הזמנה לא נמצאה' });
    if (order.paymentType !== 'CREDIT_CARD')
      return res.status(400).json({ error: 'הזמנה זו אינה בתשלום כרטיס אשראי' });
    if (order.paymentStatus !== 'PENDING')
      return res.status(409).json({ error: 'לא ניתן לפתוח תשלום להזמנה זו', paymentStatus: order.paymentStatus });

    const base = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
    const returnUrl = `${base}/index.html?payment=return&orderId=${orderId}`;

    const session = await paymentService.createHostedPaymentSession({
      orderId,
      orderNumber: order.orderNumber,
      amount: order.totalAmount,
      customerName: order.customerName,
      customerEmail: order.email,
      customerPhone: order.phone,
      returnUrl,
    });

    if (!session.success) {
      console.error(`[payment] init failed for order ${orderId}: ${session.errorCode} — ${session.errorMessage}`);
      return res.status(502).json({ error: 'שגיאה בפתיחת תשלום', errorCode: session.errorCode });
    }

    await db.createPendingPayment({ orderId, amount: order.totalAmount });
    res.status(200).json({ success: true, redirectUrl: session.redirectUrl });
  } catch (e) {
    console.error(`[payment] /init unexpected error: ${e.message}`);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// POST /api/payment/webhook — קלט לא-מהימן מבחוץ (HYP). try/catch מפורש חובה:
// Express 4 עם async handler שזורק ללא טיפול מפיל את כל תהליך ה-Node, לא רק
// את הבקשה (ראה qa/README.md). לעולם לא לזרוק מכאן.
router.post('/webhook', async (req, res) => {
  try {
    const parsed = paymentService.verifyAndParseWebhook(req.body, req.headers, req.query);
    if (!parsed.verified) {
      console.error(`[payment] webhook rejected: ${parsed.errorCode} — ${parsed.errorMessage}`);
      return res.status(401).json({ error: 'unauthorized' });
    }

    const result = await db.recordPaymentResult({
      orderId: parsed.orderId,
      providerTransactionId: parsed.providerTransactionId,
      status: parsed.status,
      rawResponse: parsed.raw,
    });

    if (result.duplicate) {
      console.log(`[payment] webhook for order ${parsed.orderId} ignored — no pending payment found (duplicate/late)`);
      return res.status(200).json({ received: true });
    }

    await finalizePaymentResult(parsed.orderId, parsed.status);

    res.status(200).json({ received: true });
  } catch (e) {
    console.error(`[payment] /webhook unexpected error: ${e.message}`);
    // 500 (לא 200) בכוונה: זו יכולה להיות תקלה חולפת (DB זמנית לא זמין) — עדיף
    // ש-HYP ינסה שוב (רוב ספקי סליקה עושים retry על 5xx) מאשר לאבד אישור תשלום בשקט.
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// POST /api/payment/mock-confirm — סימולציה מקומית (payment-mock.html) בזמן
// שאין עדיין פרטי סוחר אמיתיים מ-HYP (ראה server/services/payment.js). כרטיס
// בדיקה קבוע 000000000/0000/000 = הצלחה, כל ערך אחר = דחייה. אין הגנת
// anti-forgery מעבר לכך ש-orderId הוא UUID לא ניתן לניחוש — מקובל כי זו
// סימולציה זמנית בלבד וללא כסף אמיתי מעורב (ראה FOLLOWUPS.md).
router.post('/mock-confirm', async (req, res) => {
  try {
    const { orderId, cardNumber, expiry, cvv } = req.body || {};
    if (!orderId || !UUID_RE.test(orderId)) return res.status(400).json({ error: 'orderId לא תקין' });

    const order = await db.getOrderForPayment(orderId);
    if (!order) return res.status(404).json({ error: 'הזמנה לא נמצאה' });
    if (order.paymentType !== 'CREDIT_CARD')
      return res.status(400).json({ error: 'הזמנה זו אינה בתשלום כרטיס אשראי' });
    if (order.paymentStatus !== 'PENDING')
      return res.status(409).json({ error: 'לא ניתן לאשר תשלום להזמנה זו', paymentStatus: order.paymentStatus });

    const status = (cardNumber === '000000000' && expiry === '0000' && cvv === '000') ? 'APPROVED' : 'FAILED';

    const result = await db.recordPaymentResult({
      orderId,
      providerTransactionId: 'MOCK-' + Date.now(),
      status,
      rawResponse: { mock: true, cardLast4: String(cardNumber || '').slice(-4) },
    });

    if (!result.duplicate) {
      await finalizePaymentResult(orderId, status);
    }

    res.status(200).json({ success: true, status });
  } catch (e) {
    console.error(`[payment] /mock-confirm unexpected error: ${e.message}`);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

module.exports = router;
