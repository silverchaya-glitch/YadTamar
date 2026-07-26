// שולח מייל דוח QA לכתובת קבועה (silver.chaya@gmail.com), לא לתיבת המשרד
// (MAIL_TO). מכוון בכוונה: server/services/email.js לא מייצא שום פונקציה
// ששולחת לכתובת שרירותית (sendOfficeNotification מקובעת ל-MAIL_TO) — אז
// במקום לשנות קוד production כדי לשרת בדיקות, כאן שכפול מינימלי של אותה
// שיטת שליחה (Gmail REST API עם MailComposer, בדיוק כמו services/email.js),
// באותם משתני סביבה (GMAIL_OAUTH_*/MAIL_USER) שכבר מוגדרים ב-.env. בלי תלות
// npm חדשה — nodemailer כבר dependency קיים.
const MailComposer = require('nodemailer/lib/mail-composer');

const QA_REPORT_RECIPIENT = 'silver.chaya@gmail.com';

async function getAccessToken() {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GMAIL_OAUTH_CLIENT_ID,
      client_secret: process.env.GMAIL_OAUTH_CLIENT_SECRET,
      refresh_token: process.env.GMAIL_OAUTH_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(`gmail oauth token refresh failed: ${data.error || res.status}`);
  }
  return data.access_token;
}

function buildRawMessage({ from, to, subject, html }) {
  return new Promise((resolve, reject) => {
    new MailComposer({ from, to, subject, html }).compile().build((err, message) => {
      if (err) return reject(err);
      resolve(message.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''));
    });
  });
}

// שולחת דוח QA. זורקת אם השליחה נכשלת — הקורא (qa/run-all.js) מדפיס את
// השגיאה ל-console אבל לא נכשל בגללה (הדוח המפורט כבר נשמר לקובץ בכל מקרה).
async function sendQaReport({ subject, html }) {
  if (!process.env.MAIL_USER || !process.env.GMAIL_OAUTH_CLIENT_ID || !process.env.GMAIL_OAUTH_CLIENT_SECRET || !process.env.GMAIL_OAUTH_REFRESH_TOKEN) {
    throw new Error('Gmail OAuth2 not configured (MAIL_USER/GMAIL_OAUTH_*) — אי אפשר לשלוח מייל דוח');
  }
  const fromName = process.env.MAIL_FROM_NAME || 'יד תמר QA';
  const accessToken = await getAccessToken();
  const raw = await buildRawMessage({
    from: `"${fromName}" <${process.env.MAIL_USER}>`,
    to: QA_REPORT_RECIPIENT,
    subject,
    html,
  });
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(`gmail send failed: ${data.error?.message || res.status}`);
  }
}

module.exports = { sendQaReport, QA_REPORT_RECIPIENT };
