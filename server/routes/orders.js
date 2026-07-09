const express = require('express');
const router = express.Router();
const db = require('../db');
const { triggerFulfillment } = require('../services/fulfillment');

// POST /api/orders — יצירת הזמנה חדשה
router.post('/', async (req, res) => {
  const { customer_name, phone, email, delivery_type, items, total } = req.body || {};
  if (!customer_name || !phone || !email || !delivery_type || !items || total == null)
    return res.status(400).json({ error: 'שדות חסרים' });
  if (!['DRIVE', 'USB'].includes(delivery_type))
    return res.status(400).json({ error: 'delivery_type לא תקין' });
  try {
    const id = await db.createOrder({ customer_name, phone, email, delivery_type, items, total });
    const fulfillment = await triggerFulfillment(id);
    res.status(201).json({ success: true, id, fulfillment });
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
