// ============================================================
// סיכון גבוה ביותר — לא רץ כברירת מחדל, לא חלק מ-qa/run.js, דורש שני flags.
// זוהי, לפי בקשת המשתמש (2026-07-19), הבדיקה העיקרית: אימות מקצה-לקצה שצינור
// המילוי האמיתי (Apps Script יצירת תיקייה + shareLib שיתוף) עדיין עובד בפועל.
//
// ⚠️ מה שקורה בפועל כשמריצים את זה:
//   1. נוצרת הזמנה אמיתית מסוג STORY_SELECTION עם סיפור אמיתי אחד.
//   2. triggerFulfillment קורא בפועל ל-FULFILLMENT_WEBHOOK_URL (Google Apps
//      Script אמיתי) שיוצר תיקיית Drive אמיתית ומעתיק אליה את הקובץ.
//   3. אם ה-Apps Script מחליט "שתף עכשיו" (לא WAITING_MANUAL — תלוי paymentType,
//      ראה server/services/fulfillment.js), נקרא גם ל-SHARE_WEBHOOK_URL האמיתי
//      ששולח הזמנה לשיתוף (viewer) לכתובת ה-demo.* (לא תיבת דואר אמיתית) ועשוי
//      לשלוח מייל התראה מ-shareLib.
//   4. אין ל-qa/cleanup.js גישה ל-Drive API — התיקייה שנוצרת ב-Drive האמיתי
//      *לא* נמחקת אוטומטית על ידי שום סקריפט כאן. יש למחוק אותה ידנית מ-Drive
//      אחרי כל הרצה (ה-URL מודפס בסוף הריצה).
//
// הרצה: QA_ALLOW_MUTATIONS=1 QA_ALLOW_FULFILLMENT_WEBHOOK=1 node qa/orders-fulfillment-webhook.test.js
const assert = require('assert/strict');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Pool } = require('pg');
const { createSuite } = require('./lib/runner');
const { request } = require('./lib/http');

const suite = createSuite('qa/orders-fulfillment-webhook.test.js');

async function main() {
  if (process.env.QA_ALLOW_MUTATIONS !== '1' || process.env.QA_ALLOW_FULFILLMENT_WEBHOOK !== '1') {
    console.log('qa/orders-fulfillment-webhook.test.js | SKIPPED | דורש גם QA_ALLOW_MUTATIONS=1 וגם QA_ALLOW_FULFILLMENT_WEBHOOK=1');
    return;
  }

  const demoEmail = `demo.qa-webhook-${Date.now()}@example.com`;
  const pool = new Pool();
  let story;
  let orderId;

  try {
    await suite.test('נמצא סיפור אמיתי אחד (google_drive_file_id לא placeholder) לבדיקה', async () => {
      const { rows } = await pool.query(
        `SELECT id, story_code, title FROM stories WHERE google_drive_file_id NOT LIKE 'PENDING%' ORDER BY story_code LIMIT 1`
      );
      assert.ok(rows.length, 'אין אף סיפור עם google_drive_file_id אמיתי — הריצי קודם node server/db/seed-catalog.js');
      story = rows[0];
    });

    await suite.test('POST /api/orders (STORY_SELECTION, סיפור אחד, מתויג demo.*) מחזיר 201', async () => {
      if (!story) throw new Error('אין סיפור מהבדיקה הקודמת');
      const { status, body } = await request('/api/orders', {
        method: 'POST',
        body: {
          customer_name: 'דוגמה - QA fulfillment webhook',
          phone: '050-0000097',
          email: demoEmail,
          delivery_type: 'DRIVE',
          items: { stories: [story.id] }, // בלי product -> ברירת מחדל STORY_SELECTION
          total: 8,
        },
      });
      assert.equal(status, 201);
      assert.equal(body?.success, true);
      orderId = body.id;
      assert.ok(orderId, 'לא התקבל id להזמנה');

      console.log(`qa/orders-fulfillment-webhook.test.js | (מידע) fulfillment: ${JSON.stringify(body.fulfillment)}`);
      if (body.fulfillment?.externalFolderUrl) {
        console.log(`qa/orders-fulfillment-webhook.test.js | ⚠️ נוצרה תיקיית Drive אמיתית — יש למחוק ידנית: ${body.fulfillment.externalFolderUrl}`);
      }

      // לא אוסרים success:false כאן (יכול להיות NETWORK_ERROR/TIMEOUT זמני מול ה-webhook
      // החיצוני) — אבל אם זה CONFIG_MISSING, ה-webhook לא מוגדר ב-.env בכלל וכדאי לדעת.
      assert.notEqual(body?.fulfillment?.errorCode, 'CONFIG_MISSING',
        'FULFILLMENT_WEBHOOK_URL/SECRET לא מוגדרים ב-.env — הבדיקה לא יכולה לרוץ בפועל');
    });

    await suite.test('GET /api/orders/:id על ההזמנה שנוצרה מחזיר 200 (round-trip)', async () => {
      if (!orderId) throw new Error('אין orderId מהבדיקה הקודמת');
      const { status, body } = await request(`/api/orders/${orderId}`);
      assert.equal(status, 200);
      assert.equal(body?.id, orderId);
    });

    if (orderId) {
      console.log(`qa/orders-fulfillment-webhook.test.js | (מידע) הזמנה שנוצרה: ${orderId} / ${demoEmail} — לניקוי שורות DB: node qa/cleanup.js (תיקיית Drive: מחיקה ידנית)`);
    }

    suite.finish();
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error(`qa/orders-fulfillment-webhook.test.js | FATAL | ${err.message}`);
  process.exitCode = 1;
});
