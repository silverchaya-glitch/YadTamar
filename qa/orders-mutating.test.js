// ============================================================
// סיכון גבוה — לא רץ כברירת מחדל, לא חלק מ-qa/run.js.
// יוצר שורות אמיתיות בפרודקשן (customers/orders/... מתויגות email דמו).
// הרצה: QA_ALLOW_MUTATIONS=1 node qa/orders-mutating.test.js
// ============================================================
//
// למה זה "בטוח יחסית": ההזמנה היחידה שנוצרת כאן היא מסוג ADULT_COLLECTION.
// אומת ישירות בקוד (server/services/fulfillment.js:130-132) שההזמנה הזו
// חוסמת את הקריאה ל-webhook החיצוני של Drive *לפני* שהיא מתבצעת בכלל —
// "הסקריפט (Apps Script) לא תומך ב-ADULT_COLLECTION בכלל". לכן ריצה של הקובץ
// הזה לא יוצרת תיקיית Drive אמיתית ולא שולחת מייל אמיתי — רק כותבת שורות
// אמיתיות ב-Postgres של הפרודקשן (אין סביבת staging נפרדת, ראה qa/README.md).
//
// תיוג נתוני דמה: המייל מתויג demo.* (כמו server/db/seed-fake-data.js), אבל
// order_number מקבל מספר YT-XXXX רגיל מהרצף — ה-API הציבורי לא מאפשר לקבוע
// מספר הזמנה מותאם (DEMO-XXXX) כמו שseed-fake-data.js עושה בהזרקה ישירה ל-DB.
// זהו פער מתועד בקונבנציית התיוג, לא באג. ניקוי: node qa/cleanup.js (ידני,
// אף פעם לא אוטומטי).
//
// נקודה פתוחה (לפי החלטת המשתמש 2026-07-19): כרגע HYP הוא placeholder UI בלבד
// (אין סליקת אשראי אמיתית) — הבדיקה כאן בודקת רק את יצירת ההזמנה/ה-DB/ה-fulfillment
// short-circuit. כשתיווסף סליקת אשראי אמיתית, יש להרחיב בדיקה זו (או להוסיף קובץ
// המשך) לזרימה מקצה-לקצה אמיתית כולל אישור תשלום.
const assert = require('assert/strict');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { createSuite } = require('./lib/runner');
const { request } = require('./lib/http');

const suite = createSuite('qa/orders-mutating.test.js');

async function main() {
  if (process.env.QA_ALLOW_MUTATIONS !== '1') {
    console.log('qa/orders-mutating.test.js | SKIPPED | QA_ALLOW_MUTATIONS not set to "1" — לא רץ בכוונה');
    return;
  }

  const demoEmail = `demo.qa-${Date.now()}@example.com`;
  let orderId;

  await suite.test('POST /api/orders (ADULT_COLLECTION, מתויג demo.*) מחזיר 201 ו-fulfillment.errorCode=NOT_APPLICABLE', async () => {
    const { status, body } = await request('/api/orders', {
      method: 'POST',
      body: {
        customer_name: 'דוגמה - QA orders-mutating',
        phone: '050-0000098',
        email: demoEmail,
        delivery_type: 'DRIVE',
        items: { product: 'ADULT_COLLECTION', stories: [] },
        total: 360,
      },
    });
    assert.equal(status, 201);
    assert.equal(body?.success, true);
    orderId = body.id;
    assert.ok(orderId, 'לא התקבל id להזמנה');
    // הנחת הבטיחות של כל הקובץ הזה תלויה בזה — אם זה כבר לא NOT_APPLICABLE,
    // צריך לעצור: או ש-Apps Script התחיל לתמוך ב-ADULT_COLLECTION, או שהתנהגות
    // אחרת השתנתה, וזה עלול לגרום ל-webhook Drive אמיתי מהרצה הבאה.
    assert.equal(body?.fulfillment?.errorCode, 'NOT_APPLICABLE',
      `⚠️ fulfillment.errorCode=${body?.fulfillment?.errorCode} — לא NOT_APPLICABLE! ` +
      `הנחת הבטיחות של קובץ זה השתנתה, אל תריצי שוב בלי לבדוק מה קרה.`);
  });

  await suite.test('GET /api/orders/:id על ההזמנה שנוצרה מחזיר 200 (round-trip)', async () => {
    if (!orderId) throw new Error('אין orderId מהבדיקה הקודמת');
    const { status, body } = await request(`/api/orders/${orderId}`);
    assert.equal(status, 200);
    assert.equal(body?.id, orderId);
  });

  let adminCookie;
  const adminAvailable = Boolean(process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD);
  if (adminAvailable) {
    await suite.test('admin login לצורך המשך הבדיקה', async () => {
      const { status, cookie } = await request('/api/admin/login', {
        method: 'POST',
        body: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD },
      });
      assert.equal(status, 200);
      adminCookie = cookie;
    });

    await suite.test('PATCH /api/admin/orders/:id status=paid מחזיר 200 ו-fulfillment.errorCode=NOT_APPLICABLE שוב', async () => {
      if (!orderId || !adminCookie) throw new Error('חסר orderId או adminCookie מבדיקה קודמת');
      const { status, body } = await request(`/api/admin/orders/${orderId}`, {
        method: 'PATCH',
        cookie: adminCookie,
        body: { status: 'paid' },
      });
      assert.equal(status, 200);
      assert.equal(body?.fulfillment?.errorCode, 'NOT_APPLICABLE');
    });

    suite.skip(
      'PATCH status=pending אחרי paid (בדיקת trigger prevent_paid_to_pending)',
      'לא מורץ בכוונה — admin.js PATCH /orders/:id (שורה 76) לא עוטף את db.updateOrder ב-try/catch, ' +
      'בדיוק כמו הפער ב-GET /api/orders/:id (ראה qa/negative.test.js). ה-trigger prevent_paid_to_pending ' +
      'זורק חריגה בצד ה-DB שתגרום ל-unhandled rejection ב-handler אסינכרוני של Express 4 = קריסת ' +
      'כל תהליך ה-Node (אומת בסביבה מבודדת, לא מול production). זהו אותו ממצא P0 שדווח בנפרד.'
    );
  } else {
    suite.skip('שלב admin (login/PATCH)', 'ADMIN_EMAIL/ADMIN_PASSWORD חסרים ב-.env');
  }

  if (orderId) {
    console.log(`qa/orders-mutating.test.js | (מידע) הזמנה שנוצרה: ${orderId} / ${demoEmail} — לניקוי: node qa/cleanup.js`);
  }

  suite.finish();
}

main().catch(err => {
  console.error(`qa/orders-mutating.test.js | FATAL | ${err.message}`);
  process.exitCode = 1;
});
