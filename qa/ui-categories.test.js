// בדיקות read-only על מבנה/סדר הקטגוריות. בטוח להרצה תמיד, גם מול פרודקשן —
// אין כאן אוטומציית דפדפן (Playwright/Puppeteer וכו' יהיו תלות npm חדשה,
// אסור לפי CLAUDE.md כלל 1 — האתר סטטי בכוונה). "בדיקת UI" כאן = ודאות
// שהנתונים שה-UI בפועל מציג (GET /api/catalog + הקבועים שה-HTML קורא מהם)
// נכונים ובסדר הנכון, לא רינדור ויזואלי.
//
// ההקשר: קטגוריית c17 ("ספר במדבר") נוספה לקטלוג אחרי כל שאר הספרים (id כרונולוגי
// מאוחר), אבל displayOrder שלה ב-js/data.js ממקם אותה במקומה הנכון לפי סדר חומש
// (בראשית-שמות-במדבר-יהושע...), לא בסוף. תוקן ב-Postgres בקומיט 4ac3c91 (2026-07-21).
// הבדיקה העיקרית כאן מוודאת שהחנות החיה (/api/catalog) לא נסוגה בחזרה למצב הקודם.
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

const suite = createSuite('qa/ui-categories.test.js');

async function main() {
  const { CATEGORIES } = loadDataJs();
  const { status, body } = await request('/api/catalog');

  await suite.test('GET /api/catalog מחזיר 200', async () => {
    assert.equal(status, 200);
    assert.ok(Array.isArray(body?.categories));
  });

  suite.skip('כל 18 הקטגוריות מ-js/data.js קיימות בקטלוג החי (לפי שם)', GEMARA_SKIP_REASON);

  suite.skip('סדר הקטגוריות ב-/api/catalog (לפי displayOrder) זהה בדיוק לסדר ב-js/data.js', GEMARA_SKIP_REASON);

  await suite.test('"ספר במדבר" (c17) ממוקם בין "ספר שמות" ל"ספר יהושע" (לא בסוף הרשימה)', async () => {
    const bemidbar = CATEGORIES.find(c => c.id === 'c17');
    assert.ok(bemidbar, 'c17 לא קיימת ב-js/data.js עצמו');
    const liveSorted = [...body.categories].sort((a, b) => a.displayOrder - b.displayOrder);
    const idx = liveSorted.findIndex(c => c.name === bemidbar.name);
    assert.ok(idx > 0, `"${bemidbar.name}" לא נמצאה בקטלוג החי`);
    assert.equal(liveSorted[idx - 1].name, 'ספר שמות', `הקטגוריה שלפני "${bemidbar.name}" היא "${liveSorted[idx - 1].name}", ציפינו ל"ספר שמות"`);
    assert.equal(liveSorted[idx + 1].name, 'ספר יהושע', `הקטגוריה שאחרי "${bemidbar.name}" היא "${liveSorted[idx + 1]?.name}", ציפינו ל"ספר יהושע"`);
  });

  await suite.test('לכל קטגוריה יש לפחות סיפור אחד בקטלוג החי (אין קטגוריה ריקה)', async () => {
    const byCategory = new Map();
    for (const s of body.stories) byCategory.set(s.categoryId, (byCategory.get(s.categoryId) || 0) + 1);
    const empty = body.categories.filter(c => !byCategory.get(c.id));
    assert.equal(empty.length, 0, `קטגוריות בלי אף סיפור: ${empty.map(c => c.name).join(', ')}`);
  });

  await suite.test('index.html מכיל אלמנט container לקטגוריות (בדיקה סטטית, לא רינדור בפועל)', async () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    // לא בודקים מחרוזת קשיחה אחת ספציפית — רק שיש התייחסות אמיתית לקטגוריות
    // ב-JS inline של הדף (categories/CATEGORIES), כדי לתפוס מצב שבו הרינדור
    // הוסר בטעות מה-HTML.
    assert.ok(/categories/i.test(html), 'לא נמצאה שום התייחסות ל-"categories" ב-index.html — יתכן שרינדור הקטגוריות הוסר');
  });

  suite.finish();
}

main().catch(err => {
  console.error(`qa/ui-categories.test.js | FATAL | ${err.message}`);
  process.exitCode = 1;
});
