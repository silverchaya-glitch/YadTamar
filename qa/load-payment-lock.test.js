// ============================================================
// סיכון גבוה — לא רץ כברירת מחדל, לא חלק מ-qa/run.js, דורש שני flags + עומס מקביל.
// יוצר הזמנת ADULT_COLLECTION+CREDIT_CARD אמיתית (מתויגת demo.*) ושורת payments
// PENDING אחת, ואז שולח N בקשות מקבילות אמיתיות שמנסות "לאשר" את אותו תשלום.
// הרצה: QA_ALLOW_MUTATIONS=1 QA_ALLOW_LOAD_TEST=1 node qa/load-payment-lock.test.js
//
// למה זה "בטוח יחסית": ADULT_COLLECTION חוסם קריאה ל-webhook Drive חיצוני לפני
// שהיא מתבצעת (fulfillment.js:132, NOT_APPLICABLE) — בדיוק כמו qa/orders-mutating.test.js.
//
// מה בודקים בפועל: server/db/index.js recordPaymentResult (שורות 329-373) נועלת
// את שורת ה-payments עם `SELECT ... FOR UPDATE` בתוך BEGIN/COMMIT לפני שהיא בודקת
// אם היא כבר "נצרכה" (idempotent duplicate:true). זה בדיוק המנגנון שאמור להגן על
// webhook כפול/מקבילי מ-HYP (או מכל תוקף ששולח שני POSTים בו-זמנית ל-/webhook עם
// אותו payload). הבדיקה כאן מדמה N קריאות מקביליות אמיתיות ל-/api/payment/mock-confirm
// (משתמש באותו נתיב קוד ב-recordPaymentResult כמו /webhook האמיתי) על אותה הזמנה,
// ומוודאת דרך ה-DB עצמו (לא רק תשובות ה-HTTP) ש:
//   1. אף בקשה לא זרקה/הפילה את השרת (כל התשובות 200).
//   2. בדיוק "עיבוד אמיתי" אחד קרה בפועל — לא N — נמדד דרך email_logs
//      (PURCHASE_CONFIRMATION נשלח רק מתוך finalizePaymentResult, שרץ רק כש-
//      recordPaymentResult מחזירה duplicate:false; ראה server/routes/payment.js).
//   3. מצב הסופי של payments/orders עקבי (לא "half-applied").
const assert = require('assert/strict');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Pool } = require('pg');
const { createSuite } = require('./lib/runner');
const { request } = require('./lib/http');
const { isMockMode } = require('../server/services/payment');

const suite = createSuite('qa/load-payment-lock.test.js');

const CONCURRENT_CONFIRMS = 20;

async function main() {
  if (process.env.QA_ALLOW_MUTATIONS !== '1' || process.env.QA_ALLOW_LOAD_TEST !== '1') {
    console.log('qa/load-payment-lock.test.js | SKIPPED | דורש גם QA_ALLOW_MUTATIONS=1 וגם QA_ALLOW_LOAD_TEST=1');
    return;
  }

  if (!isMockMode()) {
    console.log('qa/load-payment-lock.test.js | SKIPPED | /mock-confirm מנוטרל (בלי HYP_MOCK=true או עם מסוף HYP אמיתי) — מכוון (server/routes/payment.js), והבדיקה תלויה בו');
    return;
  }

  const pool = new Pool();
  const demoEmail = `demo.qa-lock-${Date.now()}@example.com`;
  let orderId;
  let paymentId;

  try {
    await suite.test('POST /api/orders (ADULT_COLLECTION+CREDIT_CARD, מתויג demo.*) מחזיר 201', async () => {
      const { status, body } = await request('/api/orders', {
        method: 'POST',
        body: {
          customer_name: 'דוגמה - QA load-payment-lock',
          phone: '050-0000095',
          email: demoEmail,
          delivery_type: 'DRIVE',
          items: { product: 'ADULT_COLLECTION', stories: [], paymentType: 'CREDIT_CARD' },
          total: 360,
        },
      });
      assert.equal(status, 201);
      assert.equal(body?.success, true);
      orderId = body.id;
      assert.ok(orderId, 'לא התקבל id להזמנה');
      assert.equal(body?.fulfillment, undefined, 'fulfillment אמור להיות undefined ל-CREDIT_CARD (נקרא רק מ-/return)');
    });

    // נוצר ישירות מול ה-DB (לא דרך /init) כדי לא להיות תלוי בהגדרות פרטי המסוף של HYP (HYP_TERMINAL_ID/
    // HYP_API_KEY/HYP_PASSP) (ראה qa/payment-hyp-sandbox.test.js) — המטרה כאן
    // היא לבדוק את הנעילה עצמה, לא את זרימת ה-init/session מול HYP.
    await suite.test('נוצרת שורת payments PENDING אחת ישירות ב-DB (setup, לא דרך /init)', async () => {
      const { rows } = await pool.query(
        `INSERT INTO payments (order_id, provider, amount, status) VALUES ($1,'HYP',$2,'PENDING') RETURNING id`,
        [orderId, 360]
      );
      paymentId = rows[0]?.id;
      assert.ok(paymentId, 'לא נוצרה שורת payments');
    });

    await suite.test(`${CONCURRENT_CONFIRMS} בקשות מקבילות ל-/api/payment/mock-confirm על אותה הזמנה — כולן מגיבות 200`, async () => {
      const started = Date.now();
      const results = await Promise.all(
        Array.from({ length: CONCURRENT_CONFIRMS }, () =>
          request('/api/payment/mock-confirm', {
            method: 'POST',
            timeoutMs: 10000,
            body: { orderId, cardNumber: '000000000', expiry: '0000', cvv: '000' },
          }).catch(err => ({ status: null, body: null, error: err.message }))
        )
      );
      const wallMs = Date.now() - started;
      console.log(`qa/load-payment-lock.test.js | (מידע) ${CONCURRENT_CONFIRMS} בקשות מקבילות ל-mock-confirm: ${wallMs}ms`);

      const bad = results.filter(r => r.status !== 200);
      assert.equal(bad.length, 0,
        `${bad.length}/${CONCURRENT_CONFIRMS} בקשות לא החזירו 200 — ` +
        bad.slice(0, 5).map(b => b.error || `HTTP ${b.status}: ${JSON.stringify(b.body)}`).join(' | '));

      const approved = results.filter(r => r.body?.status === 'APPROVED');
      assert.equal(approved.length, CONCURRENT_CONFIRMS,
        `כל ${CONCURRENT_CONFIRMS} הבקשות אמורות להחזיר status=APPROVED (אותו כרטיס הצלחה בכולן) — ${approved.length} עשו זאת`);
    });

    // finalizePaymentResult (server/routes/payment.js) רץ ברקע אחרי שה-HTTP
    // response כבר חזר — צריך רגע כדי שהוא יספיק לכתוב ל-email_logs.
    await suite.test('הנעילה עבדה: בדיוק "עיבוד אמיתי" אחד קרה בפועל (לא 20)', async () => {
      await new Promise(r => setTimeout(r, 1500));

      const { rows: paymentRows } = await pool.query(
        `SELECT id, status FROM payments WHERE order_id = $1`,
        [orderId]
      );
      assert.equal(paymentRows.length, 1, `אמורה להיות שורת payments אחת בלבד, יש ${paymentRows.length}`);
      assert.equal(paymentRows[0].status, 'APPROVED', `סטטוס שורת payments הוא ${paymentRows[0].status}, ציפינו ל-APPROVED`);

      const { rows: orderRows } = await pool.query(
        `SELECT payment_status, processing_status FROM orders WHERE id = $1`,
        [orderId]
      );
      assert.equal(orderRows[0]?.payment_status, 'PAID', `payment_status הוא ${orderRows[0]?.payment_status}, ציפינו ל-PAID`);

      // ⚠️ הבדיקה המרכזית: אם הנעילה (SELECT ... FOR UPDATE) לא הייתה עובדת נכון,
      // כמה בקשות מקבילות היו יכולות "לחשוב" כולן שהן הראשונות לעבד את התשלום
      // (duplicate:false) ואז finalizePaymentResult היה רץ פעמים רבות — נראה כ-N
      // שורות email_logs מסוג PURCHASE_CONFIRMATION במקום שורה אחת בדיוק.
      const { rows: emailRows } = await pool.query(
        `SELECT count(*)::int AS n FROM email_logs WHERE order_id = $1 AND email_type = 'PURCHASE_CONFIRMATION'`,
        [orderId]
      );
      const n = emailRows[0]?.n ?? 0;
      assert.equal(n, 1,
        `⚠️ נמצאו ${n} שורות email_logs (PURCHASE_CONFIRMATION) להזמנה הזו, ציפינו לבדיוק 1! ` +
        `אם n>1, הנעילה ב-recordPaymentResult (server/db/index.js SELECT...FOR UPDATE) לא מונעת ` +
        `עיבוד כפול תחת בקשות מקבילות — זה P0: תשלום כפול/מיילים כפולים ללקוח בפועל. ` +
        `אם n===0, ייתכן ש-Gmail OAuth לא מוגדר וה-log לא נכתב כלל — לבדוק לפני שמסיקים שהנעילה נכשלה.`);
    });

    if (orderId) {
      console.log(`qa/load-payment-lock.test.js | (מידע) הזמנה שנוצרה: ${orderId} / ${demoEmail} — לניקוי: node qa/cleanup.js`);
    }

    suite.finish();
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error(`qa/load-payment-lock.test.js | FATAL | ${err.message}`);
  process.exitCode = 1;
});
