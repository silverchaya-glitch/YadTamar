const express = require('express');
const router = express.Router();
const db = require('../db');
const { triggerFulfillment } = require('../services/fulfillment');
const { sendOfficeNotification } = require('../services/email');

const PAY_LABELS = { CREDIT_CARD: 'כרטיס אשראי', BANK_TRANSFER: 'העברה בנקאית', CALLBACK: 'התקשרו אליי' };

function buildOfficeNotificationHtml(order, delivery_type, items, total, fulfillment) {
  const fulfillmentLine = !fulfillment
    ? `<p>סטטוס מילוי: ממתין לאישור תשלום (כרטיס אשראי)</p>`
    : fulfillment.success && fulfillment.externalFolderUrl
      ? `<p>תיקייה: <a href="${fulfillment.externalFolderUrl}">${fulfillment.externalFolderUrl}</a> (${fulfillment.sharingStatus})</p>`
      : `<p>סטטוס מילוי: ${fulfillment.success ? fulfillment.sharingStatus : 'נכשל — ' + (fulfillment.errorCode || 'לא ידוע')}</p>`;
  return `
    <div dir="rtl" style="font-family:sans-serif">
      <h2>הזמנה חדשה — ${order.orderNumber}</h2>
      <p>לקוח: ${order.customerName} | ${order.phone} | ${order.email}</p>
      <p>אמצעי תשלום: ${PAY_LABELS[items.paymentType] || items.paymentType}</p>
      <p>סוג משלוח: ${delivery_type === 'USB' ? 'דיסק און קי' : 'קישור הורדה'}</p>
      <p>סכום: ${total} ₪</p>
      ${fulfillmentLine}
    </div>`;
}

// POST /api/orders — יצירת הזמנה חדשה
router.post('/', async (req, res) => {
  const { customer_name, phone, email, delivery_type, items, total } = req.body || {};
  if (!customer_name || !phone || !email || !delivery_type || !items || total == null)
    return res.status(400).json({ error: 'שדות חסרים' });
  if (!['DRIVE', 'USB'].includes(delivery_type))
    return res.status(400).json({ error: 'delivery_type לא תקין' });
  try {
    const order = await db.createOrder({ customer_name, phone, email, delivery_type, items, total });

    // CREDIT_CARD: אין fulfillment מיידי — נקרא רק מ-server/routes/payment.js POST /webhook,
    // אחרי אישור תשלום אמיתי מ-HYP (תיקון P1/P2 ב-FOLLOWUPS.md — עד עכשיו תוכן נמסר
    // מיד לכל אמצעי תשלום, בלי אימות תשלום בפועל). BANK_TRANSFER/CALLBACK ללא שינוי.
    const paymentType = items.paymentType || 'CREDIT_CARD'; // אותה ברירת מחדל בדיוק כמו ב-db.createOrder
    const fulfillment = paymentType === 'CREDIT_CARD' ? undefined : await triggerFulfillment(order.id);

    await sendOfficeNotification({
      subject: `הזמנה חדשה ${order.orderNumber} — יד תמר`,
      html: buildOfficeNotificationHtml(order, delivery_type, items, total, fulfillment),
      orderId: order.id,
    });

    res.status(201).json({ success: true, id: order.id, orderNumber: order.orderNumber, fulfillment });
  } catch (e) {
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// GET /api/orders/:id — סטטוס הזמנה (לדף הורדה)
router.get('/:id', async (req, res) => {
  const order = await db.getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'הזמנה לא נמצאה' });
  res.json({
    id: order.id,
    status: order.status,
    drive_folder_url: order.drive_folder_url || null
  });
});

module.exports = router;
