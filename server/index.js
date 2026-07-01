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

// Static files — serve the existing UI
app.use(express.static(path.join(__dirname, '..')));

// Routes
app.use('/api/orders', require('./routes/orders'));
app.use('/api/leads', require('./routes/leads'));
app.use('/api/admin', require('./routes/admin'));
// app.use('/api/payment', require('./routes/payment')); // פאזה 3

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', project: 'יד תמר', version: '1.0.0' });
});

app.listen(PORT, () => {
  console.log(`יד תמר שרת פועל על פורט ${PORT}`);
});
