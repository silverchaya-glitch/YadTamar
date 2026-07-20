const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();
const ENV_PATH = path.join(__dirname, '..', '..', '.env');
const REDIRECT_URI = 'https://shop.emanuel-tehila.co.il/api/oauth2/gmail/callback';

function saveRefreshToken(token) {
  let envContent = fs.readFileSync(ENV_PATH, 'utf8');
  if (!/^GMAIL_OAUTH_REFRESH_TOKEN=/m.test(envContent)) {
    envContent = envContent.replace(/\n?$/, '\n') + `GMAIL_OAUTH_REFRESH_TOKEN=${token}\n`;
  } else {
    envContent = envContent.replace(/^GMAIL_OAUTH_REFRESH_TOKEN=.*$/m, `GMAIL_OAUTH_REFRESH_TOKEN=${token}`);
  }
  fs.writeFileSync(ENV_PATH, envContent);
}

router.get('/gmail/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) {
    return res.status(400).send(`<div dir="rtl" style="font-family:sans-serif;padding:40px;text-align:center">שגיאה מגוגל: ${error}</div>`);
  }
  if (!code) {
    return res.status(400).send('<div dir="rtl" style="font-family:sans-serif;padding:40px;text-align:center">חסר קוד אישור</div>');
  }
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GMAIL_OAUTH_CLIENT_ID,
        client_secret: process.env.GMAIL_OAUTH_CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    });
    const data = await tokenRes.json();
    if (!tokenRes.ok || !data.refresh_token) {
      console.error('gmail oauth callback error:', data.error, data.error_description || '');
      return res.status(400).send(`<div dir="rtl" style="font-family:sans-serif;padding:40px;text-align:center">שגיאה בקבלת refresh token: ${data.error || 'לא ידוע'}</div>`);
    }
    saveRefreshToken(data.refresh_token);
    console.log('gmail oauth: refresh token saved to .env');
    res.send('<div dir="rtl" style="font-family:sans-serif;padding:40px;text-align:center">✅ האישור הצליח! אפשר לסגור את החלון.</div>');
  } catch (err) {
    console.error('gmail oauth callback exception:', err.message);
    res.status(500).send('<div dir="rtl" style="font-family:sans-serif;padding:40px;text-align:center">שגיאת שרת</div>');
  }
});

module.exports = router;
