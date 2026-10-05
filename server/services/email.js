const MailComposer = require('nodemailer/lib/mail-composer');
const db = require('../db');

const SITE_URL = 'https://shop.emanuel-tehila.co.il/';
// קידוד זהה למה שכבר בשימוש ב-index.html/admin.html (רק הרווח מקודד, לא התווים העבריים)
const LOGO_URL = `${SITE_URL}גלופה%20001-logo.jpg`;

// תת-קבוצה מפלטת ה-:root של index.html (ADR-007) — הצבע היחיד המותר לשימוש במיילים
const EMAIL_COLORS = {
  bg: '#F4FAFB',
  card: '#FFFFFF',
  text: '#1A1A2E',
  muted: '#6B7280',
  teal: '#00B4CC',
  tealDk: '#007A8C',
  border: '#D1E8EC',
  red: '#E74C3C',
  green: '#27AE60',
};

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// עטיפת HTML משותפת לכל המיילים — לוגו + כרטיס בגבול עדין בצבעי האתר.
// table-based בכוונה (לא flexbox/grid) לתאימות עם Outlook desktop.
function buildEmailWrapper({ bodyHtml, footerHtml = '' }) {
  return `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>יד תמר</title>
</head>
<body style="margin:0;padding:0;background-color:${EMAIL_COLORS.bg};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${EMAIL_COLORS.bg};">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"
               style="max-width:600px;width:100%;background-color:${EMAIL_COLORS.card};border:1px solid ${EMAIL_COLORS.border};border-radius:16px;">
          <tr>
            <td height="4" style="background-color:${EMAIL_COLORS.teal};font-size:0;line-height:0;border-radius:16px 16px 0 0;">&nbsp;</td>
          </tr>
          <tr>
            <td style="padding:20px 28px 16px 28px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" dir="rtl">
                <tr>
                  <td width="44" valign="middle" style="padding-left:12px;">
                    <img src="${LOGO_URL}" width="44" height="44" alt="יד תמר" style="display:block;border-radius:10px;border:0;">
                  </td>
                  <td valign="middle" style="font-family:Arial, Helvetica, sans-serif;">
                    <span style="font-size:18px;font-weight:700;color:${EMAIL_COLORS.tealDk};">יד תמר</span><br>
                    <span style="font-size:12px;color:${EMAIL_COLORS.muted};">ספריית סיפורים דיגיטלית</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr><td style="border-top:1px solid ${EMAIL_COLORS.border};font-size:0;line-height:0;">&nbsp;</td></tr>
          <tr>
            <td dir="rtl" align="right" style="padding:24px 28px;font-family:Arial, Helvetica, sans-serif;font-size:15px;line-height:1.7;color:${EMAIL_COLORS.text};">
              ${bodyHtml}
              ${footerHtml}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

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

function buildCustomerFooter() {
  return `
    <hr style="border:none;border-top:1px solid ${EMAIL_COLORS.border};margin:20px 0">
    <p style="margin:0 0 8px;">יש שאלה? אפשר גם להתקשר אלינו: <strong>04-9846776</strong> — נשמח לעזור! 📞</p>
    <p style="margin:0;">אהבתם את הסיפורים? יש עוד עשרות סיפורים שמחכים לכם —
    <a href="${SITE_URL}" style="color:${EMAIL_COLORS.tealDk};">לחצו כאן לרכישה נוספת</a> ותנו לילדים עוד רגעים קסומים. 🎧</p>`;
}

// גרסה מצומצמת — למייל שמגיע כמעט מיד אחרי מייל אחר שכבר הציג את הפוטר המלא
// (sendFileDelivery, שבד"כ מגיע תוך פחות משנייה אחרי sendPurchaseConfirmation),
// כדי לא לחזור על אותה פנייה פעמיים ברצף.
function buildCustomerFooterCompact() {
  return `
    <hr style="border:none;border-top:1px solid ${EMAIL_COLORS.border};margin:20px 0">
    <p style="margin:0;font-size:.85rem;color:${EMAIL_COLORS.muted}">שאלות? 04-9846776 · <a href="${SITE_URL}" style="color:${EMAIL_COLORS.tealDk};">לעוד סיפורים בחנות</a> 🎧</p>`;
}

function buildAdminFooter() {
  return `
    <hr style="border:none;border-top:1px solid ${EMAIL_COLORS.border};margin:20px 0">
    <p style="margin:0;"><a href="${SITE_URL}admin-login.html" style="color:${EMAIL_COLORS.tealDk};">🔐 כניסה לניהול</a></p>`;
}

async function sendPurchaseConfirmation({ orderId, customerId, orderNumber, customerName, email, total, deliveryType }) {
  // deliveryType מגיע מ-orders.delivery_type (schema.sql) — הערכים האמיתיים הם
  // SELECTED_STORIES/MASTER_LIBRARY/ADULT_COLLECTION/GEMARA/GIFT_STORY, לעולם לא 'USB'.
  const isAutoDrive = ['SELECTED_STORIES', 'MASTER_LIBRARY'].includes(deliveryType);
  const deliveryLine = isAutoDrive ? 'קישור להורדה (Google Drive)' : 'דיסק און קי';
  // רק הזמנות עם מילוי אוטומטי מקבלות מייל שני (sendFileDelivery) — ADULT_COLLECTION/GEMARA
  // מסופקות ידנית בלבד ולעולם לא יקבלו אותו (ראה fulfillment.js).
  const followUpLine = isAutoDrive
    ? '<p>הקבצים בדרך אליכם — בתוך זמן קצר יישלח אליכם מייל נפרד עם קישור ההורדה. אם הוא לא מגיע תוך זמן סביר, אפשר לפנות אלינו במענה למייל זה.</p>'
    : '';
  const bodyHtml = `
      <h2>תודה על ההזמנה, ${customerName}!</h2>
      <p>הזמנה מספר <strong>${orderNumber}</strong> התקבלה בהצלחה.</p>
      <p>סכום לתשלום: <strong>${total} ₪</strong></p>
      <p>אופן קבלת התוכן: ${deliveryLine}</p>
      ${followUpLine}
      <p>לכל שאלה ניתן לפנות אלינו במענה למייל זה.</p>`;
  const footerHtml = `${buildCustomerFooter()}
      <p>בברכה,<br>צוות יד תמר</p>`;
  const html = buildEmailWrapper({ bodyHtml, footerHtml });
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
  const bodyHtml = `
      <h2>התוכן שלך מוכן, ${customerName}!</h2>
      <p>ניתן לגשת לתיקיית ההורדה כאן:</p>
      <p><a href="${folderUrl}" style="color:${EMAIL_COLORS.tealDk};">${folderUrl}</a></p>`;
  const footerHtml = `${buildCustomerFooterCompact()}
      <p>בברכה,<br>צוות יד תמר</p>`;
  const html = buildEmailWrapper({ bodyHtml, footerHtml });
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
  const bodyHtml = `
      <h2>הסיפור במתנה שלך, ${name}!</h2>
      <p>מצורף הקישור לסיפור "<strong>${storyTitle}</strong>":</p>
      <p><a href="${storyLink}" style="color:${EMAIL_COLORS.tealDk};">${storyLink}</a></p>`;
  const footerHtml = `${buildCustomerFooter()}
      <p>בברכה,<br>צוות יד תמר</p>`;
  const html = buildEmailWrapper({ bodyHtml, footerHtml });
  return sendRawEmail({
    emailType: 'GIFT_STORY',
    to: email,
    subject: 'הסיפור במתנה שלך',
    html,
    customerId,
  });
}

const PAY_LABELS = { CREDIT_CARD: 'כרטיס אשראי', BANK_TRANSFER: 'העברה בנקאית', CALLBACK: 'התקשרו אליי' };

function buildOrderSummaryHtml({ title, orderNumber, customerName, phone, email, paymentType, deliveryType, totalAmount, statusLine, feedback, contactMePhone, notes }) {
  return `
      <h2>${title} — ${orderNumber}</h2>
      <p><span style="color:${EMAIL_COLORS.muted};">לקוח:</span> ${escapeHtml(customerName)} | ${escapeHtml(phone)} | ${escapeHtml(email)}</p>
      <p><span style="color:${EMAIL_COLORS.muted};">אמצעי תשלום:</span> ${PAY_LABELS[paymentType] || paymentType}</p>
      <p><span style="color:${EMAIL_COLORS.muted};">סוג משלוח:</span> ${deliveryType === 'USB' ? 'דיסק און קי' : 'קישור הורדה'}</p>
      <p><span style="color:${EMAIL_COLORS.muted};">סכום:</span> ${totalAmount} ₪</p>
      ${contactMePhone ? `<p>📞 הלקוח/ה ביקש/ה שניצור קשר טלפוני</p>` : ''}
      ${feedback ? `<p>💬 משוב מהלקוח/ה: ${escapeHtml(feedback)}</p>` : ''}
      ${notes ? `<p>📝 ${escapeHtml(notes)}</p>` : ''}
      ${statusLine}`;
}

function buildFulfillmentStatusLine(fulfillment) {
  if (!fulfillment) {
    return `<p>סטטוס מילוי: ממתין לאישור תשלום (כרטיס אשראי)</p>`;
  }
  if (fulfillment.success && fulfillment.externalFolderUrl) {
    return `<p style="color:${EMAIL_COLORS.green};">תיקייה: <a href="${fulfillment.externalFolderUrl}" style="color:${EMAIL_COLORS.tealDk};">${fulfillment.externalFolderUrl}</a> (${fulfillment.sharingStatus})</p>`;
  }
  if (!fulfillment.success && fulfillment.errorCode === 'NOT_APPLICABLE') {
    return `<p>סטטוס מילוי: לא רלוונטי — נדרש מילוי ידני (דיסק און קי)</p>`;
  }
  return `<p style="color:${fulfillment.success ? EMAIL_COLORS.green : EMAIL_COLORS.red};">סטטוס מילוי: ${fulfillment.success ? fulfillment.sharingStatus : 'נכשל — ' + (fulfillment.errorCode || 'לא ידוע')}</p>`;
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

async function sendPaymentApprovedOfficeNotification({ orderId, customerId, orderNumber, customerName, phone, email, paymentType, deliveryType, totalAmount, fulfillment, notes }) {
  return sendOfficeNotification({
    subject: `תשלום אושר — הזמנה ${orderNumber}`,
    html: buildOrderSummaryHtml({
      title: 'תשלום אושר', orderNumber, customerName, phone, email, paymentType, deliveryType, totalAmount,
      statusLine: buildFulfillmentStatusLine(fulfillment),
      notes,
    }),
    orderId,
    customerId,
  });
}

async function sendPaymentFailedOfficeNotification({ orderId, customerId, orderNumber, customerName, phone, email, paymentType, deliveryType, totalAmount, notes }) {
  return sendErrorNotification({
    subject: `תשלום נכשל — הזמנה ${orderNumber}`,
    html: buildOrderSummaryHtml({
      title: 'תשלום נכשל', orderNumber, customerName, phone, email, paymentType, deliveryType, totalAmount,
      statusLine: `<p style="color:${EMAIL_COLORS.red}">⚠️ התשלום לא הושלם — יש ליצור קשר עם הלקוח.</p>`,
      notes,
    }),
    orderId,
  });
}

async function sendOfficeNotification({ subject, html, orderId = null, customerId = null }) {
  return sendRawEmail({
    emailType: 'OFFICE_NOTIFICATION',
    to: process.env.MAIL_TO,
    subject,
    html: buildEmailWrapper({ bodyHtml: html, footerHtml: buildAdminFooter() }),
    orderId,
    customerId,
  });
}

async function sendErrorNotification({ subject, html, orderId = null }) {
  return sendRawEmail({
    emailType: 'ERROR_NOTIFICATION',
    to: process.env.MAIL_TO,
    subject,
    html: buildEmailWrapper({ bodyHtml: html, footerHtml: buildAdminFooter() }),
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
