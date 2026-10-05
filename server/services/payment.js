// שער תשלום HYP (pay.hyp.co.il) — עמוד תשלום מתארח + אימות עסקה.
// מקור: https://developers.hyp.co.il/pay (getting-started/creating-a-payment-page,
// reference/actions, security/transaction-validation). זרימה:
//   1. createHostedPaymentSession — בקשת APISign&What=SIGN מהשרת; HYP מחזירה מחרוזת
//      פרמטרים חתומה, והלקוח מופנה עם המחרוזת ל-HYP_PAY_URL.
//   2. HYP מחזירה את הלקוח לכתובת ההצלחה שהוגדרה בפורטל (GET /api/payment/return).
//   3. verifyReturn — אם HYP_VERIFY_ENABLED=true, שולח VERIFY עם כל פרמטרי החזרה.
// אף פונקציה כאן לא זורקת — כמו fulfillment.js/email.js.

const HYP_PAY_URL = 'https://pay.hyp.co.il/p/';
const TIMEOUT_MS = 60_000;

// כל תשלום בחלוקה חייב להיות לפחות 200 ₪, עד 10 תשלומים (החלטת הבעלים).
const MIN_INSTALLMENT_AMOUNT = 200;
const MAX_INSTALLMENTS = 10;

function maxInstallments(amount) {
  const n = Math.floor(Number(amount) / MIN_INSTALLMENT_AMOUNT);
  return Math.max(1, Math.min(MAX_INSTALLMENTS, n));
}

function verifyEnabled() {
  return process.env.HYP_VERIFY_ENABLED === 'true';
}

function credentials() {
  return {
    masof: process.env.HYP_TERMINAL_ID,
    key: process.env.HYP_API_KEY,
    passP: process.env.HYP_PASSP,
  };
}

// מצב מדומה (payment-mock.html + /mock-confirm) פעיל רק בפיתוח: כשחסר פרט מסוף
// וגם HYP_SANDBOX אינו 'false'. מקור יחיד לתנאי, כדי שהנתיב וההפניה לא יסטו זה מזה.
function isMockMode() {
  const { masof, key, passP } = credentials();
  return (!masof || !key || !passP) && process.env.HYP_SANDBOX !== 'false';
}

function toQuery(params) {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
}

// GET ל-HYP עם timeout; מחזיר {ok, text} או {ok:false, errorCode, errorMessage}.
async function hypGet(queryString) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(`${HYP_PAY_URL}?${queryString}`, { signal: controller.signal });
    return { ok: resp.ok, status: resp.status, text: (await resp.text()).trim() };
  } catch (err) {
    return { ok: false, errorCode: err.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR', errorMessage: err.message };
  } finally {
    clearTimeout(timer);
  }
}

async function createHostedPaymentSession({ orderId, orderNumber, amount, customerName, customerEmail, customerPhone, returnUrl }) {
  const { masof, key, passP } = credentials();

  if (!masof || !key || !passP) {
    // אין פרטי מסוף מלאים — עמוד תשלום מדומה מקומי (payment-mock.html) לפיתוח.
    // ב-HYP_SANDBOX=false עדיף להיכשל בבירור ולא ליפול למדומה.
    if (isMockMode()) {
      const base = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
      const mockUrl = `${base}/payment-mock.html?orderId=${encodeURIComponent(orderId)}`
        + `&orderNumber=${encodeURIComponent(orderNumber || '')}`
        + `&amount=${encodeURIComponent(amount)}`
        + `&returnUrl=${encodeURIComponent(returnUrl)}`;
      return { success: true, redirectUrl: mockUrl, providerSessionId: null, raw: { mock: true } };
    }
    return { success: false, errorCode: 'CONFIG_MISSING', errorMessage: 'HYP_TERMINAL_ID/HYP_API_KEY/HYP_PASSP not configured' };
  }

  const [firstName, ...rest] = String(customerName || '').trim().split(/\s+/);
  const installments = maxInstallments(amount);

  const query = toQuery({
    action: 'APISign',
    What: 'SIGN',
    Masof: masof,
    KEY: key,
    PassP: passP,
    Sign: verifyEnabled() ? 'True' : undefined,
    Amount: Number(amount).toFixed(2),
    Coin: 1, // שקל ישראלי
    Order: orderId,
    PageLang: 'HEB',
    ClientName: firstName,
    ClientLName: rest.join(' '),
    email: customerEmail,
    cell: customerPhone,
    Tash: installments > 1 ? installments : undefined,
    SendHesh: 'True',
  });

  const res = await hypGet(query);
  if (res.errorCode) return { success: false, errorCode: res.errorCode, errorMessage: res.errorMessage };

  // תשובה תקינה: מחרוזת פרמטרים עם action=pay; שגיאה: CCode (902 = PassP שגוי, 904 = חסר What).
  const parsed = new URLSearchParams(res.text);
  if (res.ok && parsed.get('action') === 'pay') {
    // מחרוזת ה-SIGN נשארת בייט-ב-בייט כפי ש-HYP החזירה (קידוד/סדר משפיעים על החתימה);
    // מסירים ממנה רק אישורים, למקרה ש-HYP מחזירה אותם (בדוגמת המסמכים הם לא מופיעים).
    const signed = stripReservedParams(res.text, new Set(['key', 'passp']));
    return { success: true, redirectUrl: `${HYP_PAY_URL}?${signed}`, providerSessionId: null, raw: { params: [...parsed.keys()] } };
  }
  const errorCode = parsed.get('CCode') || `HTTP_${res.status}`;
  return { success: false, errorCode, errorMessage: `Unexpected SIGN response (HTTP ${res.status})` };
}

// מעבד את פרמטרי החזרה מ-HYP (req.query + ה-query string הגולמי, שסדרו נדרש ל-VERIFY).
// הצלחה = CCode=0 בלבד; כל קוד אחר = כישלון (fail-closed). כש-HYP_VERIFY_ENABLED=true
// נשלח גם VERIFY, ובלעדיו אין אישור. לא זורקת לעולם.
// פרמטרי החזרה מגיעים מהדפדפן (לא-מהימן) ומועברים ל-VERIFY אחרי האישורים שלנו.
// מסירים מפתחות שמגדירים את הבקשה עצמה, כדי שלא יידרסו (למשל Masof של מסוף אחר).
// עובדים על המחרוזת הגולמית — סדר ואנקודינג של שאר הפרמטרים נשמרים כפי ש-HYP דורשת.
const RESERVED_PARAMS = new Set(['action', 'what', 'masof', 'key', 'passp']);
function stripReservedParams(rawQueryString, names = RESERVED_PARAMS) {
  return String(rawQueryString || '')
    .split('&')
    .filter(part => {
      if (!part) return false;
      let name = part.split('=')[0];
      try { name = decodeURIComponent(name.replace(/\+/g, ' ')); } catch { /* שם לא תקין — נשאר כפי שהוא */ }
      return !names.has(name.toLowerCase());
    })
    .join('&');
}

async function verifyReturn(query, rawQueryString) {
  const orderId = query.Order;
  const base = {
    orderId,
    amount: query.Amount,
    providerTransactionId: query.Id || null,
    ccode: String(query.CCode ?? ''),
    raw: query,
  };

  if (verifyEnabled()) {
    const { masof, key, passP } = credentials();
    if (!masof || !key || !passP) {
      return { ...base, ok: false, errorCode: 'CONFIG_MISSING', errorMessage: 'HYP credentials not configured' };
    }
    const prefix = toQuery({ action: 'APISign', What: 'VERIFY', Masof: masof, KEY: key, PassP: passP });
    const res = await hypGet(`${prefix}&${stripReservedParams(rawQueryString)}`);
    if (res.errorCode) return { ...base, ok: false, errorCode: res.errorCode, errorMessage: res.errorMessage };
    if (new URLSearchParams(res.text).get('CCode') !== '0') {
      return { ...base, ok: false, errorCode: 'VERIFY_FAILED', errorMessage: `VERIFY returned: ${res.text}` };
    }
  }

  return { ...base, ok: true, approved: base.ccode === '0' };
}

module.exports = { createHostedPaymentSession, verifyReturn, maxInstallments, isMockMode, stripReservedParams };
