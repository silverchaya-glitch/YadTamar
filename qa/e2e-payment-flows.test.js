// ============================================================
// סיכון בינוני — לא רץ כברירת מחדל, לא חלק מ-qa/run.js.
// יוצר 3 הזמנות אמיתיות בפרודקשן (customers/orders/payments מתויגות email דמו),
// אחת לכל אמצעי תשלום נתמך: CREDIT_CARD, BANK_TRANSFER, CALLBACK (טלפון).
// הרצה: QA_ALLOW_MUTATIONS=1 node qa/e2e-payment-flows.test.js
//
// למה זה "בטוח יחסית", בדיוק כמו qa/orders-mutating.test.js: כל שלוש ההזמנות
// הן ADULT_COLLECTION — server/services/fulfillment.js:132 חוסם קריאה ל-webhook
// חיצוני של Drive לפני שהיא מתבצעת בכלל (NOT_APPLICABLE), גם דרך המסלול הרגיל
// (triggerFulfillment) וגם דרך אישור תשלום ידני (confirmManualPayment נופלת חזרה
// ל-triggerFulfillment כשאין עדיין fulfillment_requests, ראה fulfillment.js:267-268).
// אז אף אחת מהזרימות כאן לא יוצרת תיקיית Drive אמיתית או שולחת מייל שיתוף אמיתי.
//
// מטרת הבדיקה: לוודא מקצה-לקצה (יצירת הזמנה -> אישור תשלום -> סטטוס סופי) עבור
// כל אחד משלושת אמצעי התשלום שהמערכת תומכת בהם היום (server/db/index.js שורה 28,
// 34: STATUS_FILTERS). CREDIT_CARD עובר דרך /api/payment/mock-confirm (סימולציה
// מקומית — אין עדיין פרטי סוחר HYP אמיתיים, ראה qa/payment-hyp-sandbox.test.js);
// BANK_TRANSFER/CALLBACK עוברים דרך אישור ידני של אדמין (PATCH .../orders/:id).
const assert = require('assert/strict');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { createSuite } = require('./lib/runner');
const { request } = require('./lib/http');
const { isMockMode } = require('../server/services/payment');

const suite = createSuite('qa/e2e-payment-flows.test.js');

// /mock-confirm פעיל רק במצב מדומה (server/services/payment.js isMockMode). עם מסוף
// HYP אמיתי או HYP_SANDBOX=false הוא מחזיר 404 בכוונה, ובדיקות כרטיס האשראי מדולגות.
const mockOpen = isMockMode();
const ccTest = (name, fn) => mockOpen
  ? suite.test(name, fn)
  : Promise.resolve(suite.skip(name, '/mock-confirm מנוטרל (מסוף HYP אמיתי או HYP_SANDBOX=false) — מכוון'));

// polling קצר — finalizePaymentResult (server/routes/payment.js) רץ ברקע אחרי
// שה-HTTP response כבר חזר (כדי לא לעכב את הלקוח), אז הסטטוס הסופי לא בהכרח
// זמין מיד אחרי מייל mock-confirm. לא sleep שרירותי — בודק בפועל עד שהמצב מתייצב.
async function waitForStatus(orderId, expectedStatuses, { attempts = 10, delayMs = 300 } = {}) {
  let last;
  for (let i = 0; i < attempts; i++) {
    const { status, body } = await request(`/api/orders/${orderId}`);
    assert.equal(status, 200);
    last = body;
    if (expectedStatuses.includes(body?.status)) return body;
    await new Promise(r => setTimeout(r, delayMs));
  }
  throw new Error(`סטטוס לא הגיע ל-${JSON.stringify(expectedStatuses)} אחרי ${attempts} ניסיונות — נשאר "${last?.status}"`);
}

async function createAdultCollectionOrder(label, paymentType) {
  const demoEmail = `demo.qa-e2e-${label}-${Date.now()}@example.com`;
  const { status, body } = await request('/api/orders', {
    method: 'POST',
    body: {
      customer_name: `דוגמה - QA e2e ${label}`,
      phone: '050-0000096',
      email: demoEmail,
      delivery_type: 'DRIVE',
      items: { product: 'ADULT_COLLECTION', stories: [], paymentType },
      total: 360,
    },
  });
  assert.equal(status, 201, `יצירת הזמנה (${label}) נכשלה: ${JSON.stringify(body)}`);
  assert.equal(body?.success, true);
  const orderId = body.id;
  assert.ok(orderId, `לא התקבל id להזמנה (${label})`);
  return { orderId, demoEmail };
}

async function adminLogin() {
  const { status, cookie } = await request('/api/admin/login', {
    method: 'POST',
    body: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD },
  });
  assert.equal(status, 200, 'admin login נכשל — בדקי ADMIN_EMAIL/ADMIN_PASSWORD ב-.env');
  return cookie;
}

async function main() {
  if (process.env.QA_ALLOW_MUTATIONS !== '1') {
    console.log('qa/e2e-payment-flows.test.js | SKIPPED | QA_ALLOW_MUTATIONS not set to "1" — לא רץ בכוונה');
    return;
  }

  const createdOrders = [];

  // --- CREDIT_CARD, אישור מוצלח (mock-confirm) ---------------------------
  await ccTest('CREDIT_CARD מקצה-לקצה: הזמנה -> mock-confirm (הצלחה) -> status=paid', async () => {
    const { orderId, demoEmail } = await createAdultCollectionOrder('cc-ok', 'CREDIT_CARD');
    createdOrders.push({ orderId, demoEmail, label: 'CREDIT_CARD (הצלחה)' });

    const { status: initStatus } = await request(`/api/payment/${orderId}/init`, { method: 'POST' });
    assert.ok([200, 502].includes(initStatus), `סטטוס init לא צפוי: ${initStatus}`);
    if (initStatus !== 200) {
      console.log('qa/e2e-payment-flows.test.js | (מידע) /init החזיר 502 (פרטי מסוף HYP חסרים/שגויים) — ' +
        'mock-confirm עדיין אמור לעבוד כי הוא לא תלוי ב-init, אבל אין payments.PENDING שנוצר דרך init; ' +
        'ראה גם qa/load-payment-lock.test.js שמייצר PENDING ישירות מול ה-DB לאותה סיבה.');
    }

    const { status, body } = await request('/api/payment/mock-confirm', {
      method: 'POST',
      body: { orderId, cardNumber: '000000000', expiry: '0000', cvv: '000' },
    });
    assert.equal(status, 200);
    assert.equal(body?.success, true);
    assert.equal(body?.status, 'APPROVED');

    if (initStatus === 200) {
      const order = await waitForStatus(orderId, ['paid', 'fulfilled']);
      assert.ok(['paid', 'fulfilled'].includes(order.status));
    } else {
      // בלי init, recordPaymentResult לא מוצא PENDING payment (idempotent duplicate:true)
      // ולא מעדכן את ה-order בכלל — זו לא נפילה של הבדיקה, זו מגבלה תיעודית ידועה.
      console.log('qa/e2e-payment-flows.test.js | (מידע) דילוג על בדיקת status=paid — אין PENDING payment ליצור בלי init מוצלח');
    }
  });

  // --- CREDIT_CARD, אישור נכשל (mock-confirm עם פרטי כרטיס שגויים) -------
  await ccTest('CREDIT_CARD מקצה-לקצה: הזמנה -> mock-confirm (כישלון) -> status=failed', async () => {
    const { orderId, demoEmail } = await createAdultCollectionOrder('cc-fail', 'CREDIT_CARD');
    createdOrders.push({ orderId, demoEmail, label: 'CREDIT_CARD (כישלון)' });

    const { status: initStatus } = await request(`/api/payment/${orderId}/init`, { method: 'POST' });
    assert.ok([200, 502].includes(initStatus));

    const { status, body } = await request('/api/payment/mock-confirm', {
      method: 'POST',
      body: { orderId, cardNumber: '111111111', expiry: '1111', cvv: '111' },
    });
    assert.equal(status, 200);
    assert.equal(body?.status, 'FAILED');

    if (initStatus === 200) {
      const order = await waitForStatus(orderId, ['failed']);
      assert.equal(order.status, 'failed');
    } else {
      console.log('qa/e2e-payment-flows.test.js | (מידע) דילוג על בדיקת status=failed — אין PENDING payment ליצור בלי init מוצלח');
    }
  });

  // --- BANK_TRANSFER + CALLBACK, אישור ידני של אדמין ----------------------
  const adminAvailable = Boolean(process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD);
  if (adminAvailable) {
    for (const [label, paymentType] of [['BANK_TRANSFER', 'BANK_TRANSFER'], ['CALLBACK (טלפון)', 'CALLBACK']]) {
      await suite.test(`${label} מקצה-לקצה: הזמנה -> pending_manual -> אישור ידני אדמין -> status=paid`, async () => {
        const { orderId, demoEmail } = await createAdultCollectionOrder(paymentType.toLowerCase(), paymentType);
        createdOrders.push({ orderId, demoEmail, label });

        const before = await request(`/api/orders/${orderId}`);
        assert.equal(before.status, 200);
        assert.equal(before.body?.status, 'pending_manual',
          `הזמנת ${label} טרייה אמורה להיות pending_manual, בפועל: ${before.body?.status}`);

        const cookie = await adminLogin();
        const { status, body } = await request(`/api/admin/orders/${orderId}`, {
          method: 'PATCH',
          cookie,
          body: { status: 'paid' },
        });
        assert.equal(status, 200);
        assert.equal(body?.fulfillment?.errorCode, 'NOT_APPLICABLE',
          `⚠️ fulfillment.errorCode=${body?.fulfillment?.errorCode} — לא NOT_APPLICABLE! ` +
          'הנחת הבטיחות של קובץ זה השתנתה (ADULT_COLLECTION כבר לא חוסם fulfillment חיצוני).');

        const after = await request(`/api/orders/${orderId}`);
        assert.equal(after.status, 200);
        assert.equal(after.body?.status, 'paid', `אחרי אישור ידני, סטטוס ${label} הוא ${after.body?.status}, ציפינו ל-paid`);
      });
    }
  } else {
    suite.skip('BANK_TRANSFER / CALLBACK (אישור ידני אדמין)', 'ADMIN_EMAIL/ADMIN_PASSWORD חסרים ב-.env');
  }

  if (createdOrders.length) {
    console.log('qa/e2e-payment-flows.test.js | (מידע) הזמנות שנוצרו:');
    for (const o of createdOrders) console.log(`  - ${o.label}: ${o.orderId} / ${o.demoEmail}`);
    console.log('qa/e2e-payment-flows.test.js | לניקוי: node qa/cleanup.js');
  }

  suite.finish();
}

main().catch(err => {
  console.error(`qa/e2e-payment-flows.test.js | FATAL | ${err.message}`);
  process.exitCode = 1;
});
