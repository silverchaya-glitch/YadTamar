const TIMEOUT_MS = 60_000;

// TBD מוחלט: כתובת ה-endpoint, שמות שדות הבקשה/תשובה, וצורת ה-redirect (JSON עם URL
// מול טופס auto-submit) תלויים במסמכי ה-API בפועל של HYP (dashboard.hyp.co.il) —
// עדיין לא בידינו. מבנה זה נבנה כך שיהיה קל להתאים ברגע שהמסמכים יגיעו: החוזה
// {success, redirectUrl, providerSessionId, raw, errorCode, errorMessage} לא צריך
// להשתנות, רק הפנימיות של הפונקציה. לא זורקת לעולם — כמו fulfillment.js/email.js.
async function createHostedPaymentSession({ orderId, orderNumber, amount, customerName, customerEmail, customerPhone, returnUrl }) {
  const baseUrl = process.env.HYP_API_BASE_URL;
  const apiKey = process.env.HYP_API_KEY;
  const terminalId = process.env.HYP_TERMINAL_ID;
  if (!baseUrl || !apiKey || !terminalId) {
    return { success: false, errorCode: 'CONFIG_MISSING', errorMessage: 'HYP_API_BASE_URL/HYP_API_KEY/HYP_TERMINAL_ID not configured' };
  }

  // TBD — שמות השדות הבאים הם ניחוש סביר בלבד (נפוץ אצל ספקי סליקה ישראליים),
  // לא אושרו מול מסמכי HYP בפועל. יש להחליף לפי המסמכים כשיגיעו.
  const body = {
    apiKey,
    terminalId,
    sandbox: process.env.HYP_SANDBOX !== 'false',
    orderId,
    orderNumber,
    amount,
    currency: 'ILS',
    customerName,
    customerEmail,
    customerPhone,
    returnUrl,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(`${baseUrl}/payment/init`, { // TBD — נתיב לא מאושר
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await resp.text();
    const data = (() => { try { return JSON.parse(text); } catch { return null; } })();

    if (data && (data.redirectUrl || data.url)) { // TBD — שם השדה בפועל
      return {
        success: true,
        redirectUrl: data.redirectUrl || data.url,
        providerSessionId: data.sessionId || data.transactionId || null,
        raw: data,
      };
    }

    const errorCode = (data && data.errorCode) || `HTTP_${resp.status}`;
    const errorMessage = (data && data.errorMessage) || `Unexpected response (HTTP ${resp.status})`;
    return { success: false, errorCode, errorMessage, raw: data };
  } catch (err) {
    const errorCode = err.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR';
    return { success: false, errorCode, errorMessage: err.message };
  } finally {
    clearTimeout(timer);
  }
}

// TBD מוחלט: מנגנון האימות עצמו (HMAC על raw body? header signature? secret קבוע
// בגוף הבקשה, כמו המוסכמה הקיימת בפרויקט עבור FULFILLMENT_WEBHOOK_SECRET?), שם
// השדה שבו HYP מחזיר את ה-orderId שהעברנו ב-init, ומיפוי ערכי הסטטוס בפועל
// ל-'APPROVED'/'FAILED' הפנימיים שלנו. הכשל הוא "סגור" (fail-closed): בלי
// HYP_WEBHOOK_SECRET מוגדר, שום payload לא ייחשב מאומת. לא זורקת לעולם.
function verifyAndParseWebhook(body, headers, query) {
  const secret = process.env.HYP_WEBHOOK_SECRET;
  if (!secret) {
    return { verified: false, errorCode: 'CONFIG_MISSING', errorMessage: 'HYP_WEBHOOK_SECRET not configured' };
  }
  if (!body || typeof body !== 'object') {
    return { verified: false, errorCode: 'BAD_PAYLOAD', errorMessage: 'Empty or non-object webhook body' };
  }

  // TBD — placeholder: משווה secret שקיבלנו ישירות בגוף הבקשה (body.secret), בהשראת
  // המוסכמה הקיימת ל-FULFILLMENT_WEBHOOK_SECRET. אם HYP חותם HMAC על raw body במקום
  // זאת, יש להחליף להשוואת חתימה (crypto.timingSafeEqual על HMAC-SHA256 וכו') ברגע
  // שמנגנון האימות האמיתי יתברר, ולוודא ש-server/index.js תופס את ה-raw body
  // (verify callback ב-express.json()) אם צריך.
  const providedSecret = body.secret || headers['x-hyp-secret'] || query.secret;
  if (!providedSecret || providedSecret !== secret) {
    return { verified: false, errorCode: 'INVALID_SECRET', errorMessage: 'Webhook secret mismatch' };
  }

  const orderId = body.orderId; // TBD — שם השדה בפועל
  if (!orderId || !/^[0-9a-f-]{36}$/i.test(orderId)) {
    return { verified: false, errorCode: 'BAD_PAYLOAD', errorMessage: 'Missing or invalid orderId in webhook payload' };
  }

  // TBD — מיפוי ערכי סטטוס HYP בפועל ('approved'/'success'/'0' וכו') לא ידוע.
  const rawStatus = String(body.status || '').toUpperCase();
  const status = ['APPROVED', 'SUCCESS', 'PAID', 'OK'].includes(rawStatus) ? 'APPROVED' : 'FAILED';

  return {
    verified: true,
    orderId,
    providerTransactionId: body.transactionId || body.providerTransactionId || null,
    status,
    raw: body,
  };
}

module.exports = { createHostedPaymentSession, verifyAndParseWebhook };
