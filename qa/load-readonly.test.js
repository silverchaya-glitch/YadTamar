// ============================================================
// סיכון: read-only (בלי כתיבה ל-DB), אבל לא רץ כברירת מחדל ולא חלק מ-qa/run.js —
// זו בכל זאת הצפת production אמיתי ב-30 בקשות בו-זמנית, לא בקשה בודדת כמו שאר
// הבדיקות הבטוחות. דורש הסכמה מפורשת בכל הרצה, בדיוק כמו השכבות המתויגות.
// הרצה: QA_ALLOW_LOAD_TEST=1 node qa/load-readonly.test.js
//
// מטרה: לדמות 30 "משתמשים" שגולשים בחנות בו-זמנית (GET /api/catalog חוזר),
// ולוודא: (1) אף בקשה לא נכשלת/נופלת, (2) התהליך לא קורס תוך כדי (ראה P0 ב-
// qa/README.md — unhandled rejection ב-Express 4 מפיל את כל התהליך, לא רק בקשה
// בודדת), (3) זמני תגובה סבירים תחת עומס מקביל.
//
// מגבלה ידועה: אין גישת SSH/מוניטורינג לתהליך עצמו מכאן — "אין קריסה" נבדק
// באופן עקיף (HTTP בלבד): כל 30 הבקשות המקבילות חייבות להצליח, ובנוסף בדיקת
// "פינג" נוספת רצה shortly אחרי (ואחרי RestartSec=3 של systemd) כדי לתפוס מצב
// שבו קריסה+התאוששות אוטומטית קרתה כתוצאה מהעומס אך לא נראתה בבקשות המקוריות.
const assert = require('assert/strict');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { createSuite } = require('./lib/runner');
const { request } = require('./lib/http');

const suite = createSuite('qa/load-readonly.test.js');

const CONCURRENT_USERS = 30;
const REQUEST_TIMEOUT_MS = 10000;

function percentile(sortedArr, p) {
  if (!sortedArr.length) return 0;
  const idx = Math.min(sortedArr.length - 1, Math.floor((p / 100) * sortedArr.length));
  return sortedArr[idx];
}

async function timedRequest(pathName) {
  const start = Date.now();
  try {
    const { status } = await request(pathName, { timeoutMs: REQUEST_TIMEOUT_MS });
    return { ok: status >= 200 && status < 300, status, ms: Date.now() - start };
  } catch (err) {
    return { ok: false, status: null, ms: Date.now() - start, error: err.message };
  }
}

async function main() {
  if (process.env.QA_ALLOW_LOAD_TEST !== '1') {
    console.log('qa/load-readonly.test.js | SKIPPED | QA_ALLOW_LOAD_TEST not set to "1" — לא רץ בכוונה (30 בקשות מקבילות מול production)');
    return;
  }

  let results = [];

  await suite.test(`${CONCURRENT_USERS} משתמשים במקביל על GET /api/catalog — כולם מצליחים`, async () => {
    const started = Date.now();
    results = await Promise.all(
      Array.from({ length: CONCURRENT_USERS }, () => timedRequest('/api/catalog'))
    );
    const wallMs = Date.now() - started;

    const failed = results.filter(r => !r.ok);
    const durations = results.map(r => r.ms).sort((a, b) => a - b);
    const p50 = percentile(durations, 50);
    const p95 = percentile(durations, 95);
    const max = durations[durations.length - 1];

    console.log(`qa/load-readonly.test.js | (מידע) ${CONCURRENT_USERS} בקשות מקבילות: wall=${wallMs}ms, p50=${p50}ms, p95=${p95}ms, max=${max}ms`);

    assert.equal(failed.length, 0,
      `${failed.length}/${CONCURRENT_USERS} בקשות נכשלו — ` +
      failed.slice(0, 5).map(f => f.error || `HTTP ${f.status}`).join(' | '));
  });

  await suite.test('בדיקת "עדיין חי" מיד אחרי הפרץ (בקשה בודדת נוספת)', async () => {
    const r = await timedRequest('/api/catalog');
    assert.ok(r.ok, `בקשה מיידית אחרי הפרץ נכשלה (${r.error || r.status}) — ייתכן שהתהליך קרס`);
  });

  await suite.test('בדיקת "עדיין חי" אחרי חלון RestartSec=3 (תופס קריסה מאוחרת/אסינכרונית)', async () => {
    await new Promise(r => setTimeout(r, 4000));
    const r = await timedRequest('/api/catalog');
    assert.ok(r.ok, `בקשה 4 שניות אחרי הפרץ נכשלה (${r.error || r.status}) — ייתכן שהתהליך קרס והתאושש (yadtamar.service Restart=always)`);
  });

  suite.finish();
}

main().catch(err => {
  console.error(`qa/load-readonly.test.js | FATAL | ${err.message}`);
  process.exitCode = 1;
});
