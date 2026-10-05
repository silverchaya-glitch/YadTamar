const express = require('express');
const router = express.Router();
const db = require('../db');
const paymentService = require('../services/payment');
const { triggerFulfillment } = require('../services/fulfillment');
const { sendPurchaseConfirmation, sendFileDelivery, sendPaymentApprovedOfficeNotification, sendPaymentFailedOfficeNotification } = require('../services/email');

const UUID_RE = /^[0-9a-f-]{36}$/i;

// לוגיקת ה-side-effects אחרי שסטטוס תשלום נקבע (APPROVED/FAILED) — משותפת
// ל-/return האמיתי ול-/mock-confirm (סימולציה, ראה למטה), כדי לא לשכפל אותה.
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
        notes: order.notes,
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
        notes: order.notes,
      });
    } else {
      console.error(`[payment] payment failed for unknown order ${orderId} — could not send office notification`);
    }
  }
}

// POST /api/payment/:orderId/init — פותח עסקת תשלום מול HYP ומחזיר redirectUrl
// לדף התשלום המאובטח שלהם. נקרא מ-index.html מיד אחרי POST /api/orders להזמנת
// CREDIT_CARD (ראה server/routes/orders.js — triggerFulfillment לא נקרא שם עבור
// CREDIT_CARD בכלל; זה קורה רק מ-/return למטה, אחרי אישור תשלום אמיתי).
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

// GET /api/payment/return — כתובת ההצלחה שמוגדרת בפורטל HYP ("עסקה שהצליחה" ←
// "לינק מותאם אישית"). הדפדפן של הלקוח מגיע לכאן עם פרמטרי העסקה, ולכן זה קלט
// לא-מהימן: ההכרעה (CCode=0 + VERIFY כש-HYP_VERIFY_ENABLED=true + התאמת סכום)
// נעשית בשרת. HYP לא מציעה webhook — אם הלקוח סוגר את הדפדפן לפני החזרה, ההזמנה
// נשארת PENDING (ראה FOLLOWUPS.md). try/catch מפורש חובה (Express 4 + async).
router.get('/return', async (req, res) => {
  const rawQuery = req.originalUrl.split('?')[1] || '';
  // ה-front (handlePaymentReturn) מכריע לפי GET /api/orders/:id, לא לפי פרמטרים כאן.
  const back = (orderId) =>
    res.redirect(`/index.html?payment=return${orderId ? `&orderId=${orderId}` : ''}`);
  try {
    const result = await paymentService.verifyReturn(req.query, rawQuery);
    const orderId = result.orderId;
    if (!orderId || !UUID_RE.test(orderId)) {
      console.error('[payment] /return without a valid Order parameter');
      return back(null);
    }
    if (!result.ok) {
      console.error(`[payment] /return order ${orderId} not verified: ${result.errorCode} — ${result.errorMessage}`);
      return back(orderId);
    }

    const order = await db.getOrderForPayment(orderId);
    if (!order) return back(null);
    if (order.paymentStatus !== 'PENDING') return back(orderId); // רענון/חזרה כפולה — כבר טופל

    // הסכום ש-HYP חייבה חייב להיות זה שמחושב אצלנו, אחרת לא מאשרים (נרשם ללוג בלבד;
    // ההזמנה נשארת PENDING לבדיקה ידנית — ייתכן שחויב סכום שגוי).
    // Amount חסר/לא מספרי (NaN) נדחה גם הוא — השוואה עם NaN תמיד false ולכן הייתה מדלגת.
    const chargedAmount = typeof result.amount === 'string' ? Number(result.amount) : NaN;
    if (result.approved && !(Math.abs(chargedAmount - Number(order.totalAmount)) <= 0.005)) {
      console.error(`[payment] /return order ${orderId} AMOUNT MISMATCH: charged ${result.amount}, expected ${order.totalAmount} (HYP Id ${result.providerTransactionId})`);
      return back(orderId);
    }

    const status = result.approved ? 'APPROVED' : 'FAILED';
    const recorded = await db.recordPaymentResult({
      orderId,
      providerTransactionId: result.providerTransactionId,
      status,
      rawResponse: result.raw,
    });
    back(orderId);
    if (!recorded.duplicate) {
      finalizePaymentResult(orderId, status).catch(e =>
        console.error(`[payment] return order ${orderId} background finalize failed: ${e.message}`)
      );
    }
  } catch (e) {
    console.error(`[payment] /return unexpected error: ${e.message}`);
    back(null);
  }
});

// POST /api/payment/mock-confirm — סימולציה מקומית (payment-mock.html) בזמן
// שאין עדיין פרטי סוחר אמיתיים מ-HYP (ראה server/services/payment.js). כרטיס
// בדיקה קבוע 000000000/0000/000 = הצלחה, כל ערך אחר = דחייה. אין הגנת
// anti-forgery מעבר לכך ש-orderId הוא UUID לא ניתן לניחוש — מקובל כי זו
// סימולציה זמנית בלבד וללא כסף אמיתי מעורב (ראה FOLLOWUPS.md).
router.post('/mock-confirm', async (req, res) => {
  try {
    // הנתיב פעיל רק במצב מדומה (פיתוח, בלי מסוף מלא ו-HYP_SANDBOX!=='false') — אחרת מי
    // שמכיר orderId (נחשף בכתובת החזרה) היה מסמן הזמנה כשולמה בלי חיוב.
    if (!paymentService.isMockMode()) {
      return res.status(404).json({ error: 'not found' });
    }
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

    // עונים ללקוח מיד אחרי שהתשלום נרשם — ראו ההערה המקבילה ב-/return למעלה על
    // הסיבה (fulfillment יכול לקחת עד 2 דקות, זה מה שגרם ל"שלם עכשיו" להיתקע).
    res.status(200).json({ success: true, status });

    if (!result.duplicate) {
      finalizePaymentResult(orderId, status).catch(e =>
        console.error(`[payment] mock-confirm order ${orderId} background finalize failed: ${e.message}`)
      );
    }
  } catch (e) {
    console.error(`[payment] /mock-confirm unexpected error: ${e.message}`);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

module.exports = router;
