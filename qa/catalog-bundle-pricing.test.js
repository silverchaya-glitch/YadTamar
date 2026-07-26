// בדיקת תמחור חבילת "בר מצוה/בת מצוה" (c16 ב-js/data.js) — קטגוריה שנמכרת רק
// כחבילה שלמה במחיר קבוע (BUNDLE_ONLY_PRICE), לא לפי סיפור בודד. read-only
// לחלוטין: רק GET מ-/api/catalog, שום כתיבה ל-DB.
//
// ההקשר: קומיט מ-2026-07-20 הוסיף את חסימת הבחירה הבודדת ב-index.html, אבל
// BUNDLE_ONLY_CATEGORY_ID היה hardcoded ל-'c16' (הקוד מ-js/data.js) בזמן שהחנות
// טוענת את הקטלוג בפועל מ-/api/catalog עם UUID אמיתיים — ההשוואה מעולם לא
// התקיימה, וכל 11 הסיפורים היו ניתנים לבחירה בודדת במחיר המדורג הרגיל, לא ₪15
// קבוע (תוקן ב-2026-07-22, ראה FOLLOWUPS.md). הבדיקה הראשונה כאן היא regression
// ישיר לבאג הזה — טוענת את הלוגיקה האמיתית מ-index.html (לא שכפול שלה) ומריצה
// אותה מול קטלוג אמיתי מה-DB החי, בדיוק כמו ש-loadCatalog() עושה בדפדפן.
const assert = require('assert/strict');
const { createSuite } = require('./lib/runner');
const { request } = require('./lib/http');
const { loadDataJs } = require('./lib/load-data-js');
const { loadStoreLogic } = require('./lib/load-store-logic');

const suite = createSuite('qa/catalog-bundle-pricing.test.js');

async function main() {
  const { calcTotal } = loadDataJs();
  const { status, body } = await request('/api/catalog');

  await suite.test('GET /api/catalog מחזיר 200', async () => {
    assert.equal(status, 200);
    assert.ok(Array.isArray(body?.categories) && Array.isArray(body?.stories));
  });

  const store = loadStoreLogic();
  store.setLiveCatalog(body.categories, body.stories);

  await suite.test('BUNDLE_ONLY_CATEGORY_ID נפתר ל-UUID אמיתי, לא null (regression לבאג 2026-07-22)', async () => {
    const id = store.getBundleOnlyCategoryId();
    assert.ok(id, `BUNDLE_ONLY_CATEGORY_ID הוא ${id} — הקטגוריה "${store.BUNDLE_ONLY_CATEGORY_NAME}" לא נמצאה בקטלוג החי`);
    assert.notEqual(id, 'c16', 'BUNDLE_ONLY_CATEGORY_ID עדיין קוד סטטי מ-js/data.js, לא UUID אמיתי מה-DB');
  });

  const bundleId = store.getBundleOnlyCategoryId();
  const bundleStories = body.stories.filter(s => s.categoryId === bundleId);

  await suite.test('יש בדיוק 11 סיפורים בקטגוריית בר/בת מצוה בקטלוג החי', async () => {
    assert.equal(bundleStories.length, 11, `נמצאו ${bundleStories.length} סיפורים, ציפינו ל-11`);
  });

  await suite.test('בחירת כל 11 סיפורי הבר/בת-מצוה יחד מתומחרת כחבילה קבועה, לא כסיפורים בודדים', async () => {
    store.state.selectedStories = new Set(bundleStories.map(s => s.id));
    const breakdown = store.getSelectionBreakdown();
    assert.equal(breakdown.bundleSelected, true, 'bundleSelected אמור להיות true כשכל 11 הסיפורים נבחרו');
    assert.equal(breakdown.regularQty, 0, `regularQty אמור להיות 0, לא ${breakdown.regularQty} — הסיפורים נספרים כסיפורים רגילים במקום כחבילה`);
    const total = store.getSelectionTotal();
    assert.equal(total, store.BUNDLE_ONLY_PRICE, `getSelectionTotal()=${total}, ציפינו למחיר החבילה הקבוע ₪${store.BUNDLE_ONLY_PRICE}`);
    const wrongTieredTotal = calcTotal(bundleStories.length);
    assert.notEqual(total, wrongTieredTotal, `המחיר בפועל (${total}) זהה למקרה שבו 11 הסיפורים היו מתומחרים לפי המדרגה הרגילה (${wrongTieredTotal}) — זה בדיוק הבאג שתוקן`);
  });

  await suite.test('בחירת חבילת בר/בת-מצוה יחד עם 5 סיפורים רגילים נוספים — כל צד מתומחר בנפרד', async () => {
    const regularExtra = body.stories.filter(s => s.categoryId !== bundleId).slice(0, 5);
    store.state.selectedStories = new Set([...bundleStories.map(s => s.id), ...regularExtra.map(s => s.id)]);
    const breakdown = store.getSelectionBreakdown();
    assert.equal(breakdown.bundleSelected, true);
    assert.equal(breakdown.regularQty, 5, `regularQty אמור להיות 5 (רק הסיפורים הרגילים), לא ${breakdown.regularQty}`);
    const total = store.getSelectionTotal();
    const expected = calcTotal(5) + store.BUNDLE_ONLY_PRICE;
    assert.equal(total, expected, `getSelectionTotal()=${total}, ציפינו ל-calcTotal(5)+${store.BUNDLE_ONLY_PRICE}=${expected}`);
  });

  await suite.test('ביטול בחירת החבילה (לא נבחר כלום) — bundleSelected=false ומחיר 0', async () => {
    store.state.selectedStories = new Set();
    const breakdown = store.getSelectionBreakdown();
    assert.equal(breakdown.bundleSelected, false);
    assert.equal(store.getSelectionTotal(), 0);
  });

  suite.finish();
}

main().catch(err => {
  console.error(`qa/catalog-bundle-pricing.test.js | FATAL | ${err.message}`);
  process.exitCode = 1;
});
