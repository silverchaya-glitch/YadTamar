// בדיקות read-only על GET /api/catalog. לא כותב שום דבר — בטוח להרצה תמיד,
// גם מול פרודקשן. חלק מהריצה של qa/run.js.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { createSuite } = require('./lib/runner');
const { request } = require('./lib/http');
const { loadDataJs } = require('./lib/load-data-js');

const suite = createSuite('qa/catalog.test.js');

async function main() {
  const { CATEGORIES, STORIES } = loadDataJs();
  const { status, body } = await request('/api/catalog');

  await suite.test('GET /api/catalog מחזיר 200 עם המבנה הצפוי', async () => {
    assert.equal(status, 200);
    assert.ok(Array.isArray(body?.categories), 'categories חייב להיות מערך');
    assert.ok(Array.isArray(body?.stories), 'stories חייב להיות מערך');
  });

  await suite.test('18 קטגוריות פעילות (לפי CLAUDE/conventions.md, c1–c18)', async () => {
    assert.equal(body.categories.length, 18, `נמצאו ${body.categories.length} קטגוריות`);
  });

  await suite.test('מספר הסיפורים בקטלוג החי (Postgres) תואם ל-js/data.js', async () => {
    // בכוונה לא קובע מספר קשיח (438) — משווה מול המקור עצמו כדי לא לשכפל
    // קבוע שכבר סטה פעם אחת בעבר (ראה FOLLOWUPS.md, TOTAL_STORIES).
    assert.equal(body.stories.length, STORIES.length,
      `יש ${body.stories.length} סיפורים ב-/api/catalog אבל ${STORIES.length} ב-js/data.js — ` +
      `כנראה js/data.js השתנה מאז שהורצה seed-catalog.js`);
  });

  await suite.test('displayOrder של הקטגוריות ייחודי וממויין', async () => {
    const orders = body.categories.map(c => c.displayOrder);
    assert.equal(new Set(orders).size, orders.length, 'יש displayOrder כפול');
    const sorted = [...orders].sort((a, b) => a - b);
    assert.deepEqual(orders, sorted, 'הסדר שחוזר מה-API לא ממויין לפי displayOrder');
  });

  await suite.test('5 סיפורי גמרא (קטגוריית c18) קיימים בקטלוג החי', async () => {
    const gemaraCategory = CATEGORIES.find(c => c.id === 'c18');
    assert.ok(gemaraCategory, 'לא נמצאה קטגוריית c18 ב-js/data.js עצמו — לבדוק את הקובץ');
    const liveCategory = body.categories.find(c => c.name === gemaraCategory.name);
    assert.ok(liveCategory, `הקטגוריה "${gemaraCategory.name}" לא קיימת ב-/api/catalog`);
    const gemaraStories = body.stories.filter(s => s.categoryId === liveCategory.id);
    assert.equal(gemaraStories.length, 5, `נמצאו ${gemaraStories.length} סיפורי גמרא, ציפינו ל-5`);
  });

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
