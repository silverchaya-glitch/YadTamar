const express = require('express');
const router = express.Router();
const db = require('../db');
const { triggerFulfillment } = require('../services/fulfillment');
const { sendOrderPlacedOfficeNotification } = require('../services/email');

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

    await sendOrderPlacedOfficeNotification({
      orderId: order.id,
      customerId: order.customerId,
      orderNumber: order.orderNumber,
      customerName: order.customerName,
      phone: order.phone,
      email: order.email,
      paymentType,
      deliveryType: delivery_type,
      totalAmount: total,
      fulfillment,
      feedback: items.feedback,
      contactMePhone: items.contactMePhone,
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
