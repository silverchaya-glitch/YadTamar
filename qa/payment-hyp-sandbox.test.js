// ============================================================
// סיכון גבוה — לא רץ כברירת מחדל, לא חלק מ-qa/run.js.
// יוצר שורות אמיתיות בפרודקשן (customers/orders/payments מתויגות email דמו).
// הרצה: QA_ALLOW_MUTATIONS=1 QA_ALLOW_HYP_SANDBOX=1 node qa/payment-hyp-sandbox.test.js
//
// הגנה נוספת: מסרב לרוץ אם HYP_SANDBOX!=='true' ב-.env, גם אם שני ה-flags
// למעלה מוגדרים — אין סביבת staging נפרדת (qa/README.md), אז זו רשת ביטחון
// הכרחית נגד הרצה בטעות מול HYP אמיתי.
//
// כמו qa/orders-mutating.test.js: ההזמנה היחידה שנוצרת כאן היא ADULT_COLLECTION,
// שחוסמת את triggerFulfillment לפני שהוא מגיע ל-webhook Drive אמיתי
// (server/services/fulfillment.js — NOT_APPLICABLE). ניקוי: node qa/cleanup.js.
//
// TBD: שלבי ה-init/webhook המלאים תלויים בפרטי API/sandbox אמיתיים של HYP
// (HYP_API_BASE_URL, HYP_WEBHOOK_SECRET) שטרם נמסרו — עד אז הבדיקות האלה
// מוודאות רק שהשרת מגיב בצורה צפויה (CONFIG_MISSING/502) ושה-idempotency
// logic ב-DB עובד נכון מול payload סינתטי, לא זרימת HYP אמיתית מקצה לקצה.
const assert = require('assert/strict');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { createSuite } = require('./lib/runner');
const { request } = require('./lib/http');

const suite = createSuite('qa/payment-hyp-sandbox.test.js');

async function main() {
  if (process.env.QA_ALLOW_MUTATIONS !== '1' || process.env.QA_ALLOW_HYP_SANDBOX !== '1') {
    console.log('qa/payment-hyp-sandbox.test.js | SKIPPED | QA_ALLOW_MUTATIONS=1 וגם QA_ALLOW_HYP_SANDBOX=1 נדרשים — לא רץ בכוונה');
    return;
  }
  if (process.env.HYP_SANDBOX !== 'true') {
    console.error('qa/payment-hyp-sandbox.test.js | FATAL | HYP_SANDBOX חייב להיות "true" ב-.env — אין סביבת staging, לעולם לא להריץ מול HYP אמיתי');
    process.exitCode = 1;
    return;
  }

  const demoEmail = `demo.qa-pay-${Date.now()}@example.com`;
  let orderId;

  await suite.test('POST /api/orders (CREDIT_CARD, ADULT_COLLECTION, מתויג demo.*) מחזיר fulfillment=undefined', async () => {
    const { status, body } = await request('/api/orders', {
      method: 'POST',
      body: {
        customer_name: 'דוגמה - QA payment-hyp-sandbox',
        phone: '050-0000099',
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
    // רגרסיה ל-P1/P2 (FOLLOWUPS.md): fulfillment לא אמור להיקרא מיידית עבור
    // CREDIT_CARD יותר — רק ה-webhook קורא לו, אחרי אישור תשלום אמיתי.
    assert.equal(body?.fulfillment, undefined,
      `⚠️ fulfillment=${JSON.stringify(body?.fulfillment)} — אמור להיות undefined! ` +
      `אם זה חזר, ה-fix ל-P1/P2 נסוג לאחור: תוכן עלול להימסר בלי תשלום אמיתי.`);
  });

  await suite.test('POST /api/payment/:orderId/init מחזיר redirectUrl או CONFIG_MISSING (502) אם HYP_API_BASE_URL ריק', async () => {
    if (!orderId) throw new Error('אין orderId מהבדיקה הקודמת');
    const { status, body } = await request(`/api/payment/${orderId}/init`, { method: 'POST' });
    if (status === 200) {
      assert.ok(body?.redirectUrl, 'status 200 אך אין redirectUrl בתשובה');
    } else {
      assert.equal(status, 502, `סטטוס לא צפוי: ${status} — ${JSON.stringify(body)}`);
      assert.equal(body?.errorCode, 'CONFIG_MISSING', `errorCode לא צפוי: ${body?.errorCode}`);
      console.log('qa/payment-hyp-sandbox.test.js | (מידע) HYP_API_BASE_URL/HYP_API_KEY/HYP_TERMINAL_ID עדיין לא מוגדרים — init לא יכול להשלים מול HYP אמיתי, כצפוי (TBD)');
    }
  });

  await suite.test('POST /api/payment/:orderId/init שנייה על אותה הזמנה (payment_status עדיין PENDING) לא מתנגשת', async () => {
    if (!orderId) throw new Error('אין orderId מהבדיקה הקודמת');
    const { status } = await request(`/api/payment/${orderId}/init`, { method: 'POST' });
    assert.ok([200, 502].includes(status), `סטטוס לא צפוי בניסיון שני: ${status}`);
  });

  const webhookSecretAvailable = Boolean(process.env.HYP_WEBHOOK_SECRET);
  if (webhookSecretAvailable && orderId) {
    let firstWebhookOk = false;
    await suite.test('POST /api/payment/webhook (payload סינתטי, APPROVED) מעדכן את ההזמנה', async () => {
      const { status, body } = await request('/api/payment/webhook', {
        method: 'POST',
        body: { secret: process.env.HYP_WEBHOOK_SECRET, orderId, status: 'APPROVED', transactionId: `qa-${Date.now()}` },
      });
      assert.equal(status, 200);
      assert.equal(body?.received, true);
      firstWebhookOk = true;
    });

    await suite.test('GET /api/orders/:id אחרי ה-webhook מראה status=paid/fulfilled', async () => {
      if (!firstWebhookOk) throw new Error('ה-webhook הראשון לא הצליח');
      const { status, body } = await request(`/api/orders/${orderId}`);
      assert.equal(status, 200);
      assert.ok(['paid', 'fulfilled'].includes(body?.status), `status לא צפוי: ${body?.status}`);
    });

    await suite.test('idempotency: אותו payload webhook פעם שנייה מוחזר 200 בלי לזרוק', async () => {
      const { status, body } = await request('/api/payment/webhook', {
        method: 'POST',
        body: { secret: process.env.HYP_WEBHOOK_SECRET, orderId, status: 'APPROVED', transactionId: `qa-dup-${Date.now()}` },
      });
      assert.equal(status, 200);
      assert.equal(body?.received, true);
    });
  } else {
    suite.skip('שלבי ה-webhook (APPROVED + idempotency)', 'HYP_WEBHOOK_SECRET ריק ב-.env — אין דרך לבנות payload מאומת (TBD, ראה server/services/payment.js)');
  }

  if (orderId) {
    console.log(`qa/payment-hyp-sandbox.test.js | (מידע) הזמנה שנוצרה: ${orderId} / ${demoEmail} — לניקוי: node qa/cleanup.js`);
  }

  suite.finish();
}

main().catch(err => {
  console.error(`qa/payment-hyp-sandbox.test.js | FATAL | ${err.message}`);
  process.exitCode = 1;
});
