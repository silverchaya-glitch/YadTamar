const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const db = require('../db');
const { confirmManualPayment } = require('../services/fulfillment');
const { sendFileDelivery } = require('../services/email');

const pool = new Pool();

// POST /api/admin/login — ציבורי
router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'יש למלא דוא"ל וסיסמה' });

  const { rows } = await pool.query(
    'SELECT id, password_hash, is_active FROM admin_users WHERE email = $1',
    [email]
  );
  const admin = rows[0];
  if (!admin || !admin.is_active) return res.status(401).json({ error: 'שם משתמש או סיסמה שגויים' });

  const valid = await bcrypt.compare(password, admin.password_hash);
  if (!valid) return res.status(401).json({ error: 'שם משתמש או סיסמה שגויים' });

  await pool.query('UPDATE admin_users SET last_login_at = now() WHERE id = $1', [admin.id]);

  const token = jwt.sign({ role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '8h' });
  res.cookie('admin_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 8 * 60 * 60 * 1000
  });
  res.json({ ok: true });
});

// POST /api/admin/logout — ציבורי
router.post('/logout', (_req, res) => {
  res.clearCookie('admin_token', { httpOnly: true, sameSite: 'strict' });
  res.json({ ok: true });
});

function auth(req, res, next) {
  const token = req.cookies?.admin_token;
  if (!token) return res.status(401).json({ error: 'אין הרשאה — יש להתחבר' });
  try {
    jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (e) {
    const msg = e.name === 'TokenExpiredError' ? 'הפעלה פגה — יש להתחבר מחדש' : 'טוקן לא תקין';
    res.status(401).json({ error: msg });
  }
}

router.use(auth);

// GET /api/admin/me
router.get('/me', (_req, res) => res.json({ email: process.env.ADMIN_EMAIL }));

// GET /api/admin/kpi
router.get('/kpi', async (_req, res) => res.json(await db.getKPI()));

// GET /api/admin/orders?status=...
router.get('/orders', async (req, res) => {
  res.json(await db.getOrders(req.query.status));
});

// PATCH /api/admin/orders/:id
router.patch('/orders/:id', async (req, res) => {
  const allowed = ['status', 'drive_folder_url', 'notes', 'fulfillment_status'];
  const fields = Object.fromEntries(
    Object.entries(req.body).filter(([k]) => allowed.includes(k))
  );
  if (!Object.keys(fields).length) return res.status(400).json({ error: 'אין שדות לעדכון' });
  await db.updateOrder(req.params.id, fields);

  let fulfillment;
  if (fields.status === 'paid' || fields.fulfillment_status !== undefined) {
    fulfillment = await confirmManualPayment(req.params.id);
    // מייל "התוכן שלך מוכן" ללקוח — רק כששיתוף בפועל הושלם עכשיו (sharingStatus
    // 'SHARED', לא רק WAITING_MANUAL), ולא בלחיצה חוזרת על "שולם" כשכבר שותף
    // בעבר (alreadyShared).
    if (fulfillment.success && fulfillment.sharingStatus === 'SHARED' && fulfillment.externalFolderUrl && !fulfillment.alreadyShared) {
      const order = await db.getOrderForPayment(req.params.id);
      if (order) {
        await sendFileDelivery({
          orderId: order.id,
          customerId: order.customerId,
          customerName: order.customerName,
          email: order.email,
          folderUrl: fulfillment.externalFolderUrl,
        });
      }
    }
  }
  res.json({ success: true, fulfillment });
});

// GET /api/admin/leads
router.get('/leads', async (_req, res) => res.json(await db.getLeads()));

// PATCH /api/admin/leads/:id
router.patch('/leads/:id', async (req, res) => {
  const allowed = ['gift_sent'];
  const fields = Object.fromEntries(
    Object.entries(req.body).filter(([k]) => allowed.includes(k))
  );
  if (!Object.keys(fields).length) return res.status(400).json({ error: 'אין שדות לעדכון' });
  await db.updateLead(req.params.id, fields);
  res.json({ success: true });
});

module.exports = router;
