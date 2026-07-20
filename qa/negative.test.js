// מקרי קצה שליליים על /api/orders ו-/api/leads — כולם מעוצבים בכוונה כך שהם
// נעצרים בשכבת הוולידציה (400) או בבדיקת ה-CHECK של הדאטהבייס *לפני* שהם נכתבים
// בפועל או מגיעים ל-triggerFulfillment. לא יוצר אף שורה קבועה בטבלאות.
//
// חריג מתועד: בדיקת "מזהה לא תקין" ל-GET /api/orders/:id דולגה בכוונה (ראה
// suite.skip למטה) — אומת בסביבה מבודדת שהיא עלולה להפיל את כל תהליך ה-Node
// (unhandled rejection ב-handler אסינכרוני של Express 4 = crash, לא רק שגיאת
// בקשה בודדת). זהו ממצא P0 נפרד, לא בדיקה "בטוחה תמיד" כמו שאר הקובץ הזה.
const assert = require('assert/strict');
const { createSuite } = require('./lib/runner');
const { request } = require('./lib/http');

const suite = createSuite('qa/negative.test.js');

const VALID_ORDER_BASE = {
  customer_name: 'דוגמה - בדיקת QA שלילית',
  phone: '050-0000099',
  email: 'demo.qa-negative@example.com',
  delivery_type: 'DRIVE',
  items: { product: 'ADULT_COLLECTION', stories: [] },
  total: 360,
};

async function main() {
  suite.skip(
    'GET /api/orders/:id עם מזהה לא תקין (לא UUID)',
    'לא מורץ אוטומטית — אומת בסביבה מבודדת (לא מול production) שזריקת שגיאה ' +
    'לא-תפוסה בתוך handler אסינכרוני ב-Express 4 מפילה את כל תהליך ה-Node (exit), ' +
    'לא רק מחזירה שגיאה לבקשה הזו. orders.js:24 (GET /:id) לא עטוף ב-try/catch, ' +
    'ו-pg יזרוק על ניסיון להשוות uuid לא תקין ל-$1. ריצה בפועל תגרום כנראה לקריסת ' +
    'yadtamar.service (systemd יעלה מחדש תוך 3 שניות, אבל זו עדיין הפרעת שירות אמיתית). ' +
    'זהו ממצא P0 שדווח בנפרד למשתמש — יש להחליט אם לתקן קודם (try/catch) לפני שמריצים ' +
    'את הבדיקה הזו בפועל, ואותו הדבר חל על GET/PATCH מקבילים תחת /api/admin/*.'
  );

  await suite.test('GET /api/orders/:id עם UUID תקין שלא קיים מחזיר 404 נקי (מקרה בקרה)', async () => {
    const { status, body } = await request('/api/orders/00000000-0000-0000-0000-000000000000');
    assert.equal(status, 404);
    assert.equal(body?.error, 'הזמנה לא נמצאה');
  });

  const requiredFields = ['customer_name', 'phone', 'email', 'delivery_type', 'items', 'total'];
  for (const field of requiredFields) {
    await suite.test(`POST /api/orders בלי שדה חובה "${field}" מחזיר 400 ולא מגיע ל-fulfillment`, async () => {
      const body = { ...VALID_ORDER_BASE };
      delete body[field];
      const { status, body: resBody } = await request('/api/orders', { method: 'POST', body });
      assert.equal(status, 400, `field=${field}`);
      assert.equal(resBody?.error, 'שדות חסרים');
      assert.ok(!('fulfillment' in (resBody || {})), 'תגובת 400 לא אמורה להכיל fulfillment');
    });
  }

  await suite.test('POST /api/orders עם delivery_type לא תקין מחזיר 400, לא נכתב לDB', async () => {
    const { status, body } = await request('/api/orders', {
      method: 'POST',
      body: { ...VALID_ORDER_BASE, delivery_type: 'BITCOIN' },
    });
    assert.equal(status, 400);
    assert.equal(body?.error, 'delivery_type לא תקין');
    assert.ok(!('fulfillment' in (body || {})));
  });

  await suite.test('POST /api/orders עם total שלילי — CHECK constraint גורם ל-ROLLBACK (פער ידוע: 500 גולמי במקום 400)', async () => {
    // total_amount >= 0 CHECK (schema.sql) נכשל בתוך db.createOrder, שזורק ותופס ROLLBACK.
    // הראוט תופס את זה ב-catch (orders.js:17-18) ומחזיר 500 גנרי, בלי לקרוא ל-triggerFulfillment
    // בכלל (השורה הזו לא מגיעה אליה) — כלומר אין סיכון לwebhook אמיתי, רק תגובת שגיאה לא-אידיאלית.
    const { status, body } = await request('/api/orders', {
      method: 'POST',
      body: { ...VALID_ORDER_BASE, total: -1 },
    });
    assert.equal(status, 500, `ציפינו לפער הידוע (500 גולמי); אם זה 400 עכשיו — מישהו כבר הוסיף ולידציה, אפשר להדק את הבדיקה`);
    assert.ok(!('fulfillment' in (body || {})), 'אם total שלילי הגיע ל-fulfillment, זו רגרסיה אמיתית');
  });

  await suite.test('POST /api/leads בלי name/email מחזיר 400, בלי כתיבה ל-DB', async () => {
    const { status: s1 } = await request('/api/leads', { method: 'POST', body: { email: 'demo.qa@example.com' } });
    assert.equal(s1, 400);
    const { status: s2 } = await request('/api/leads', { method: 'POST', body: { name: 'דוגמה - QA' } });
    assert.equal(s2, 400);
  });

  suite.finish();
}

main().catch(err => {
  console.error(`qa/negative.test.js | FATAL | ${err.message}`);
  process.exitCode = 1;
});
