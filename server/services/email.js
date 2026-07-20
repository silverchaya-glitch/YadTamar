const MailComposer = require('nodemailer/lib/mail-composer');
const db = require('../db');

// שליחה דרך Gmail REST API (לא SMTP) — ה-scope gmail.send שאושר ב-OAuth2 תקף
// מול ה-API הזה, לא מול XOAUTH2 ב-SMTP הרגיל (שדורש את ה-scope הרחב mail.google.com).
// ראה server/scripts/gmail-oauth-*.js לתהליך קבלת ה-refresh token.
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

async function sendViaGmailApi({ from, to, subject, html }) {
  const accessToken = await getAccessToken();
  const raw = await buildRawMessage({ from, to, subject, html });
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

// שולחת מייל ולוגגת את התוצאה ל-email_logs. לעולם לא זורקת —
// כמו triggerFulfillment ב-services/fulfillment.js, הקוראים לא צריכים try/catch משלהם.
async function sendRawEmail({ emailType, to, subject, html, orderId = null, customerId = null }) {
  let sendStatus = 'FAILED';
  let sentAt = null;
  let error;
  try {
    if (!process.env.MAIL_USER || !process.env.GMAIL_OAUTH_CLIENT_ID || !process.env.GMAIL_OAUTH_CLIENT_SECRET || !process.env.GMAIL_OAUTH_REFRESH_TOKEN) {
      throw new Error('Gmail OAuth2 not configured (MAIL_USER/GMAIL_OAUTH_*)');
    }
    const fromName = process.env.MAIL_FROM_NAME || 'יד תמר';
    await sendViaGmailApi({
      from: `"${fromName}" <${process.env.MAIL_USER}>`,
      to,
      subject: `[טופס דיגיטל] ${subject}`,
      html,
    });
    sendStatus = 'SENT';
    sentAt = new Date();
  } catch (err) {
    error = err.message;
    console.error(`[email] ${emailType} to ${to} failed: ${error}`);
  }

  try {
    await db.logEmail({ orderId, customerId, emailType, recipientEmail: to, sendStatus, sentAt });
  } catch (err) {
    console.error(`[email] failed to write email_logs row: ${err.message}`);
  }

  return error ? { success: false, error } : { success: true };
}

async function sendPurchaseConfirmation({ orderId, customerId, orderNumber, customerName, email, total, deliveryType }) {
  const html = `
    <div dir="rtl" style="font-family:sans-serif">
      <h2>תודה על ההזמנה, ${customerName}!</h2>
      <p>הזמנה מספר <strong>${orderNumber}</strong> התקבלה בהצלחה.</p>
      <p>סכום לתשלום: <strong>${total} ₪</strong></p>
      <p>אופן קבלת התוכן: ${deliveryType === 'USB' ? 'דיסק און קי' : 'קישור להורדה (Google Drive)'}</p>
      <p>לכל שאלה ניתן לפנות אלינו במענה למייל זה.</p>
      <p>בברכה,<br>צוות יד תמר</p>
    </div>`;
  return sendRawEmail({
    emailType: 'PURCHASE_CONFIRMATION',
    to: email,
    subject: `אישור הזמנה ${orderNumber}`,
    html,
    orderId,
    customerId,
  });
}

async function sendFileDelivery({ orderId, customerId, customerName, email, folderUrl }) {
  const html = `
    <div dir="rtl" style="font-family:sans-serif">
      <h2>התוכן שלך מוכן, ${customerName}!</h2>
      <p>ניתן לגשת לתיקיית ההורדה כאן:</p>
      <p><a href="${folderUrl}">${folderUrl}</a></p>
      <p>בברכה,<br>צוות יד תמר</p>
    </div>`;
  return sendRawEmail({
    emailType: 'FILE_DELIVERY',
    to: email,
    subject: 'התוכן שלך מוכן להורדה',
    html,
    orderId,
    customerId,
  });
}

async function sendGiftStory({ customerId, name, email, storyTitle, storyLink }) {
  const html = `
    <div dir="rtl" style="font-family:sans-serif">
      <h2>הסיפור במתנה שלך, ${name}!</h2>
      <p>מצורף הקישור לסיפור "<strong>${storyTitle}</strong>":</p>
      <p><a href="${storyLink}">${storyLink}</a></p>
      <p>בברכה,<br>צוות יד תמר</p>
    </div>`;
  return sendRawEmail({
    emailType: 'GIFT_STORY',
    to: email,
    subject: 'הסיפור במתנה שלך',
    html,
    customerId,
  });
}

const PAY_LABELS = { CREDIT_CARD: 'כרטיס אשראי', BANK_TRANSFER: 'העברה בנקאית', CALLBACK: 'התקשרו אליי' };

function buildOrderSummaryHtml({ title, orderNumber, customerName, phone, email, paymentType, deliveryType, totalAmount, statusLine, feedback, contactMePhone }) {
  return `
    <div dir="rtl" style="font-family:sans-serif">
      <h2>${title} — ${orderNumber}</h2>
      <p>לקוח: ${customerName} | ${phone} | ${email}</p>
      <p>אמצעי תשלום: ${PAY_LABELS[paymentType] || paymentType}</p>
      <p>סוג משלוח: ${deliveryType === 'USB' ? 'דיסק און קי' : 'קישור הורדה'}</p>
      <p>סכום: ${totalAmount} ₪</p>
      ${contactMePhone ? `<p>📞 הלקוח/ה ביקש/ה שניצור קשר טלפוני</p>` : ''}
      ${feedback ? `<p>💬 משוב מהלקוח/ה: ${feedback}</p>` : ''}
      ${statusLine}
    </div>`;
}

function buildFulfillmentStatusLine(fulfillment) {
  return !fulfillment
    ? `<p>סטטוס מילוי: ממתין לאישור תשלום (כרטיס אשראי)</p>`
    : fulfillment.success && fulfillment.externalFolderUrl
      ? `<p>תיקייה: <a href="${fulfillment.externalFolderUrl}">${fulfillment.externalFolderUrl}</a> (${fulfillment.sharingStatus})</p>`
      : `<p>סטטוס מילוי: ${fulfillment.success ? fulfillment.sharingStatus : 'נכשל — ' + (fulfillment.errorCode || 'לא ידוע')}</p>`;
}

async function sendOrderPlacedOfficeNotification({ orderId, customerId, orderNumber, customerName, phone, email, paymentType, deliveryType, totalAmount, fulfillment, feedback, contactMePhone }) {
  return sendOfficeNotification({
    subject: `הזמנה חדשה ${orderNumber}`,
    html: buildOrderSummaryHtml({
      title: 'הזמנה חדשה', orderNumber, customerName, phone, email, paymentType, deliveryType, totalAmount,
      statusLine: buildFulfillmentStatusLine(fulfillment),
      feedback, contactMePhone,
    }),
    orderId,
    customerId,
  });
}

async function sendPaymentApprovedOfficeNotification({ orderId, customerId, orderNumber, customerName, phone, email, paymentType, deliveryType, totalAmount, fulfillment }) {
  return sendOfficeNotification({
    subject: `תשלום אושר — הזמנה ${orderNumber}`,
    html: buildOrderSummaryHtml({
      title: 'תשלום אושר', orderNumber, customerName, phone, email, paymentType, deliveryType, totalAmount,
      statusLine: buildFulfillmentStatusLine(fulfillment),
    }),
    orderId,
    customerId,
  });
}

async function sendPaymentFailedOfficeNotification({ orderId, customerId, orderNumber, customerName, phone, email, paymentType, deliveryType, totalAmount }) {
  return sendErrorNotification({
    subject: `תשלום נכשל — הזמנה ${orderNumber}`,
    html: buildOrderSummaryHtml({
      title: 'תשלום נכשל', orderNumber, customerName, phone, email, paymentType, deliveryType, totalAmount,
      statusLine: `<p style="color:#c0392b">⚠️ התשלום לא הושלם — יש ליצור קשר עם הלקוח.</p>`,
    }),
    orderId,
  });
}

async function sendOfficeNotification({ subject, html, orderId = null, customerId = null }) {
  return sendRawEmail({
    emailType: 'OFFICE_NOTIFICATION',
    to: process.env.MAIL_TO,
    subject,
    html,
    orderId,
    customerId,
  });
}

async function sendErrorNotification({ subject, html, orderId = null }) {
  return sendRawEmail({
    emailType: 'ERROR_NOTIFICATION',
    to: process.env.MAIL_TO,
    subject,
    html,
    orderId,
  });
}

module.exports = {
  sendPurchaseConfirmation,
  sendFileDelivery,
  sendGiftStory,
  sendOfficeNotification,
  sendErrorNotification,
  sendOrderPlacedOfficeNotification,
  sendPaymentApprovedOfficeNotification,
  sendPaymentFailedOfficeNotification,
};
