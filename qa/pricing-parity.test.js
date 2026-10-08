// התאמת מחיר חנות ↔ שרת. read-only: GET /api/catalog בלבד, שום כתיבה ל-DB.
//
// ההקשר (2026-10-08): השרת מחשב את מחיר ההזמנה בעצמו (server/services/pricing.js)
// ודוחה הזמנה שה-total שלה מהדפדפן שונה. המחירים לא משתנים (החלטת הבעלים), ולכן
// כל הבדל בין הלוגיקה של index.html (getOrderTotal) ללוגיקה של השרת = לקוח אמיתי
// שלא יכול להזמין, או מחיר שמוצג באתר ושונה ממה ש-HYP גובה. הבדיקה מריצה את הקוד
// האמיתי של שני הצדדים (לא שכפול) על הקטלוג החי ונכשלת בכל הבדל של אגורה.
const assert = require('assert/strict');
const { createSuite } = require('./lib/runner');
const { request } = require('./lib/http');
const { loadStoreLogic } = require('./lib/load-store-logic');
const { computeOrderPrice, amountsEqual } = require('../server/services/pricing');

const suite = createSuite('qa/pricing-parity.test.js');

// PRNG דטרמיניסטי — אותן בחירות "אקראיות" בכל ריצה (כישלון ניתן לשחזור).
function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function main() {
  const { status, body } = await request('/api/catalog');
  await suite.test('GET /api/catalog מחזיר 200', async () => {
    assert.equal(status, 200);
    assert.ok(body.stories.length > 0);
  });
  if (status !== 200) return suite.finish();

  const store = loadStoreLogic();
  store.setLiveCatalog(body.categories, body.stories);
  const catName = new Map(body.categories.map(c => [c.id, c.name]));
  const bundleId = store.getBundleOnlyCategoryId();
  const all = body.stories;
  const regular = all.filter(s => s.categoryId !== bundleId);
  const bundle = all.filter(s => s.categoryId === bundleId);

  function compare(label, { product, stories = [], useUsb }) {
    store.setState({ product, selectedStories: new Set(stories.map(s => s.id)), useUsb });
    const client = store.getOrderTotal();
    const server = computeOrderPrice({
      product,
      stories: stories.map(s => ({ id: s.id, categoryName: catName.get(s.categoryId) })),
      useUsb,
    });
    assert.ok(amountsEqual(client.total, server.total),
      `${label}: חנות ₪${client.total} מול שרת ₪${server.total}`);
    assert.ok(amountsEqual(client.usbCost, server.usbAmount || 0),
      `${label}: USB חנות ₪${client.usbCost} מול שרת ₪${server.usbAmount || 0}`);
  }

  // כל גבולות המדרגות ב-PRICING_RULES + תקרת 1550 + "בחר הכל"
  const sizes = [1, 2, 19, 20, 21, 49, 50, 51, 99, 100, 101, 149, 150, 151, 309, 310, 311, 314, 315, 316, 407, 408, regular.length];
  await suite.test('גבולות מדרגות — סיפורים רגילים, עם ובלי USB', async () => {
    for (const n of sizes.filter(n => n <= regular.length)) {
      for (const useUsb of [false, true]) compare(`${n} רגילים usb=${useUsb}`, { product: 'STORY_SELECTION', stories: regular.slice(0, n), useUsb });
    }
  });

  await suite.test('חבילת בר/בת מצוה — לבד, חלקית ועם סיפורים רגילים', async () => {
    assert.ok(bundle.length > 0, 'קטגוריית החבילה לא נמצאה בקטלוג החי');
    for (const useUsb of [false, true]) {
      compare(`חבילה בלבד usb=${useUsb}`, { product: 'STORY_SELECTION', stories: bundle, useUsb });
      compare(`סיפור חבילה אחד usb=${useUsb}`, { product: 'STORY_SELECTION', stories: bundle.slice(0, 1), useUsb });
      for (const n of [1, 38, 39, 40, 49, 314]) {
        compare(`חבילה + ${n} רגילים usb=${useUsb}`, { product: 'STORY_SELECTION', stories: [...bundle, ...regular.slice(0, n)], useUsb });
      }
    }
  });

  await suite.test('כל הספרייה (בחר הכל), עם ובלי USB', async () => {
    for (const useUsb of [false, true]) compare(`כל ${all.length} usb=${useUsb}`, { product: 'STORY_SELECTION', stories: all, useUsb });
  });

  await suite.test('אוסף מבוגרים וגמרא, עם ובלי USB', async () => {
    for (const product of ['ADULT_COLLECTION', 'GEMARA']) {
      for (const useUsb of [false, true]) compare(`${product} usb=${useUsb}`, { product, useUsb });
    }
  });

  await suite.test('500 בחירות אקראיות (seed קבוע)', async () => {
    const rnd = mulberry32(20261008);
    for (let i = 0; i < 500; i++) {
      const n = 1 + Math.floor(rnd() * all.length);
      const picked = [...all].sort(() => rnd() - 0.5).slice(0, n);
      compare(`אקראי #${i} (${n})`, { product: 'STORY_SELECTION', stories: picked, useUsb: rnd() < 0.5 });
    }
  });

  suite.finish();
}

main().catch(err => { console.error(err); process.exitCode = 1; });
