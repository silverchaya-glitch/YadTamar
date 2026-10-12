require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const express = require('express');
const cors = require('cors');
const path = require('path');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

// Route guard: admin.html דורש JWT תקין
app.get('/admin.html', (req, res, next) => {
  const token = req.cookies?.admin_token;
  if (!token) return res.redirect('/admin-login.html');
  try {
    jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.clearCookie('admin_token');
    res.redirect('/admin-login.html');
  }
});

// Allowlist לקבצים סטטיים: שורש ה-repo מוגש כ-static, ובלי הרשימה הזו נחשפו לציבור
// server.log (מיילים של לקוחות), yadtamar.db, .git/, קוד השרת, FOLLOWUPS.md ו-files/list_from_drive.csv.
// קובץ ציבורי חדש (תמונה/דף/PDF) — יש להוסיף אותו כאן, אחרת יחזיר 404.
const PUBLIC_FILES = new Set([
  '/',
  '/index.html',
  '/admin.html',
  '/admin-login.html',
  '/privacy.html',
  '/accessibility.html',
  '/gemara-icon.svg',
  '/גלופה 001-logo.jpg',   // גם בלוגו של המיילים (server/services/email.js)
  '/גלופה 001-hero.jpg',
  '/files/קטלוג מבוגרים.pdf',
  '/files/קטלוג ילדים תשפד .pdf',
  ...(process.env.HYP_MOCK === 'true' ? ['/payment-mock.html'] : []),
]);
const PUBLIC_DIRS = ['/css/', '/js/'];

function isPublicPath(urlPath) {
  let decoded;
  try { decoded = decodeURIComponent(urlPath); } catch { return false; }
  if (decoded.includes('\0') || decoded.includes('\\') || decoded.split('/').includes('..')) return false;
  return PUBLIC_FILES.has(decoded) || PUBLIC_DIRS.some(dir => decoded.startsWith(dir));
}

app.use((req, res, next) => {
  if (req.path.startsWith('/api/') || isPublicPath(req.path)) return next();
  res.status(404).send('Not found');
});

// Static files — serve the existing UI
app.use(express.static(path.join(__dirname, '..'), { dotfiles: 'deny' }));

// Routes
app.use('/api/catalog', require('./routes/catalog'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/leads', require('./routes/leads'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/payment', require('./routes/payment'));
app.use('/api/oauth2', require('./routes/oauth'));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', project: 'יד תמר', version: '1.0.0' });
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`יד תמר שרת פועל על פורט ${PORT}`);
  require('./services/daily-digest').startDailyDigest();
  require('./services/fulfillment-queue').startFulfillmentQueue();
});
