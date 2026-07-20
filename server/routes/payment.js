const express = require('express');
const router = express.Router();
const db = require('../db');
const paymentService = require('../services/payment');
const { triggerFulfillment } = require('../services/fulfillment');
const { sendPurchaseConfirmation, sendErrorNotification } = require('../services/email');

const UUID_RE = /^[0-9a-f-]{36}$/i;

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

    if (parsed.status === 'APPROVED') {
      const fulfillment = await triggerFulfillment(parsed.orderId);
      const order = await db.getOrderForPayment(parsed.orderId);
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
      }
      console.log(`[payment] order ${parsed.orderId} approved, fulfillment: ${fulfillment.success ? fulfillment.sharingStatus : 'FAILED — ' + fulfillment.errorCode}`);
    } else {
      const order = await db.getOrderForPayment(parsed.orderId);
      await sendErrorNotification({
        subject: `תשלום נכשל — הזמנה ${order ? order.orderNumber : parsed.orderId}`,
        html: `<div dir="rtl"><p>תשלום HYP נכשל להזמנה ${order ? order.orderNumber : parsed.orderId}.</p></div>`,
        orderId: parsed.orderId,
      });
    }

    res.status(200).json({ received: true });
  } catch (e) {
    console.error(`[payment] /webhook unexpected error: ${e.message}`);
    // 500 (לא 200) בכוונה: זו יכולה להיות תקלה חולפת (DB זמנית לא זמין) — עדיף
    // ש-HYP ינסה שוב (רוב ספקי סליקה עושים retry על 5xx) מאשר לאבד אישור תשלום בשקט.
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

module.exports = router;
