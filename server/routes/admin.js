const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const db = require('../db');

// POST /api/admin/login — ציבורי
router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'יש למלא דוא"ל וסיסמה' });
  if (email !== process.env.ADMIN_EMAIL || password !== process.env.ADMIN_PASSWORD)
    return res.status(401).json({ error: 'שם משתמש או סיסמה שגויים' });
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
router.get('/kpi', (_req, res) => res.json(db.getKPI()));

// GET /api/admin/orders?status=...
router.get('/orders', (req, res) => {
  res.json(db.getOrders(req.query.status));
});

// PATCH /api/admin/orders/:id
router.patch('/orders/:id', (req, res) => {
  const allowed = ['status', 'drive_folder_url', 'notes', 'fulfillment_status'];
  const fields = Object.fromEntries(
    Object.entries(req.body).filter(([k]) => allowed.includes(k))
  );
  if (!Object.keys(fields).length) return res.status(400).json({ error: 'אין שדות לעדכון' });
  db.updateOrder(Number(req.params.id), fields);
  res.json({ success: true });
});

// GET /api/admin/leads
router.get('/leads', (_req, res) => res.json(db.getLeads()));

// PATCH /api/admin/leads/:id
router.patch('/leads/:id', (req, res) => {
  const allowed = ['gift_sent'];
  const fields = Object.fromEntries(
    Object.entries(req.body).filter(([k]) => allowed.includes(k))
  );
  if (!Object.keys(fields).length) return res.status(400).json({ error: 'אין שדות לעדכון' });
  db.updateLead(Number(req.params.id), fields);
  res.json({ success: true });
});

module.exports = router;
