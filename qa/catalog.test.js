// בדיקות read-only על GET /api/catalog. לא כותב שום דבר — בטוח להרצה תמיד,
// גם מול פרודקשן. חלק מהריצה של qa/run.js.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { createSuite } = require('./lib/runner');
const { request } = require('./lib/http');
const { loadDataJs } = require('./lib/load-data-js');

// הגמרא (c18) קיימת ב-js/data.js אבל לא בקטלוג החי (Postgres) — מאושר ע"י הבעלים
// 2026-10-11: מסופקת ידנית בדיסק און קי בלבד, לא דרך החנות. לכן בדיקות שמשוות את
// הקטלוג החי ל-data.js כולל הגמרא מסומנות SKIP במקום להיכשל בכל ריצה.
const GEMARA_SKIP_REASON = 'הגמרא (c18) לא בקטלוג החי בכוונה — מאושר ע"י הבעלים 2026-10-11 (מסופקת ידנית בדיסק און קי בלבד)';

const suite = createSuite('qa/catalog.test.js');

async function main() {
  const { CATEGORIES, STORIES } = loadDataJs();
  const { status, body } = await request('/api/catalog');

  await suite.test('GET /api/catalog מחזיר 200 עם המבנה הצפוי', async () => {
    assert.equal(status, 200);
    assert.ok(Array.isArray(body?.categories), 'categories חייב להיות מערך');
    assert.ok(Array.isArray(body?.stories), 'stories חייב להיות מערך');
  });

  suite.skip('18 קטגוריות פעילות (לפי CLAUDE/conventions.md, c1–c18)', GEMARA_SKIP_REASON);

  suite.skip('מספר הסיפורים בקטלוג החי (Postgres) תואם ל-js/data.js', GEMARA_SKIP_REASON);

  await suite.test('displayOrder של הקטגוריות ייחודי וממויין', async () => {
    const orders = body.categories.map(c => c.displayOrder);
    assert.equal(new Set(orders).size, orders.length, 'יש displayOrder כפול');
    const sorted = [...orders].sort((a, b) => a - b);
    assert.deepEqual(orders, sorted, 'הסדר שחוזר מה-API לא ממויין לפי displayOrder');
  });

  suite.skip('5 סיפורי גמרא (קטגוריית c18) קיימים בקטלוג החי', GEMARA_SKIP_REASON);

  await suite.test('פער ידוע: admin.html עדיין קורא קטלוג מ-js/data.js הסטטי, לא מ-/api/catalog', async () => {
    // זה לא אמור להיכשל — זו תיעוד של פער קיים ומתועד (FOLLOWUPS.md/CLAUDE.md golden rule #5).
    // אם הבדיקה נכשלת, admin.html התחיל לקרוא את /api/catalog וצריך לעדכן את התיעוד, לא לתקן קוד.
    const adminHtml = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
    const fetchesLiveCatalog = /fetch\(\s*['"]\/api\/catalog['"]/.test(adminHtml);
    assert.ok(!fetchesLiveCatalog,
      'admin.html מתחיל לקרוא מ-/api/catalog — הפער התיעודי כבר לא קיים, יש לעדכן FOLLOWUPS.md');
  });

  suite.finish();
}

main().catch(err => {
  console.error(`qa/catalog.test.js | FATAL | ${err.message}`);
  process.exitCode = 1;
});
