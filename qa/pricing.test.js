// בדיקות לוגיקה טהורה — בלי רשת, בלי DB. טוען את js/data.js דרך vm (ראה
// qa/lib/load-data-js.js) ובודק את הפונקציות האמיתיות, לא שכפול שלהן.
// גבולות המדרגות (19/20, 49/50, 99/100, 149/150, 314/315) לא אומתו חזותית
// בדפדפן לפי PROGRESS.txt (2026-07-19) — זו בדיוק הסיבה שהבדיקה הזו קיימת.
const assert = require('assert/strict');
const { createSuite } = require('./lib/runner');
const { loadDataJs } = require('./lib/load-data-js');

const suite = createSuite('qa/pricing.test.js');

async function main() {
  const { calcUnitPrice, calcTotal, FULL_LIBRARY_PRICE, FREE_USB_MIN_FILES, USB_PRICE, PRICING_RULES } = loadDataJs();

  const boundaries = [
    { below: 19, above: 20, belowPrice: 8.0, abovePrice: 7.0 },
    { below: 49, above: 50, belowPrice: 7.0, abovePrice: 6.5 },
    { below: 99, above: 100, belowPrice: 6.5, abovePrice: 6.0 },
    { below: 149, above: 150, belowPrice: 6.0, abovePrice: 5.0 },
    { below: 314, above: 315, belowPrice: 5.0, abovePrice: 3.8 },
  ];

  for (const b of boundaries) {
    await suite.test(`מדרגת תמחור ${b.below}→${b.above}: ${b.belowPrice}₪ מול ${b.abovePrice}₪`, async () => {
      assert.equal(calcUnitPrice(b.below), b.belowPrice, `qty=${b.below} ציפינו ל-${b.belowPrice}₪`);
      assert.equal(calcUnitPrice(b.above), b.abovePrice, `qty=${b.above} ציפינו ל-${b.abovePrice}₪`);
    });
  }

  await suite.test('מדרגת התמחור הראשונה (PRICING_RULES[0]) עדיין 1–19 ב-8₪', async () => {
    assert.equal(PRICING_RULES[0].min, 1);
    assert.equal(PRICING_RULES[0].max, 19);
    assert.equal(PRICING_RULES[0].unitPrice, 8.0);
  });

  await suite.test(`calcTotal נעצר בתקרת FULL_LIBRARY_PRICE (${FULL_LIBRARY_PRICE}₪)`, async () => {
    // כמות גדולה מספיק שבלי הצמדה היתה חוצה את מחיר הספרייה המלאה
    const qty = 500; // 500 * 3.8 = 1900 > 1550
    const total = calcTotal(qty);
    assert.ok(qty * calcUnitPrice(qty) > FULL_LIBRARY_PRICE, 'תרחיש הבדיקה לא רלוונטי יותר — לעדכן qty');
    assert.equal(total, FULL_LIBRARY_PRICE, `calcTotal(${qty}) = ${total}, ציפינו להצמדה ל-${FULL_LIBRARY_PRICE}`);
  });

  await suite.test('גבול USB חינם — 49 מול 50 קבצים (מראה server/db/index.js:87)', async () => {
    // הלוגיקה הזו חיה בפועל ב-server/db/index.js (לא ב-js/data.js) ואין לה export —
    // הבדיקה כאן משכפלת את התנאי המדויק בכוונה, ולכן אינה בודקת את הקוד האמיתי
    // אלא רק שההבנה שלנו את הכללים העסקיים לא סטתה. אם server/db/index.js:87 משתנה,
    // יש לעדכן את התנאי כאן גם.
    const usbFee = (product, filesCount) =>
      (product === 'ADULT_COLLECTION' || filesCount >= FREE_USB_MIN_FILES) ? 0 : USB_PRICE;

    assert.equal(usbFee('STORY_SELECTION', 49), USB_PRICE, '49 קבצים אמור עדיין לגבות USB_PRICE');
    assert.equal(usbFee('STORY_SELECTION', 50), 0, '50 קבצים אמור להיות USB חינם');
    assert.equal(usbFee('ADULT_COLLECTION', 1), 0, 'אוסף מבוגרים תמיד USB חינם');
  });

  suite.finish();
}

main().catch(err => {
  console.error(`qa/pricing.test.js | FATAL | ${err.message}`);
  process.exitCode = 1;
});
