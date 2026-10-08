// חישוב מחיר הזמנה בצד השרת — המחיר מהדפדפן לא נסמך עליו (סקירת קוד 2026-10-08:
// אפשר היה להזמין את כל הספרייה ב-₪1). המחירון נטען מ-js/data.js עצמו (אותו vm
// כמו server/db/seed-catalog.js ו-qa/lib/load-data-js.js), כך שהחנות והשרת חולקים
// מקור יחיד. הלוגיקה כאן משקפת בדיוק את getSelectionTotal/getOrderTotal ב-index.html —
// qa/pricing-parity.test.js נכשל בכל הבדל. מחירים לא משתנים (החלטת הבעלים), ולכן
// אי-התאמה מול הדפדפן משמעה מניפולציה.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadPricing() {
  const code = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'data.js'), 'utf8');
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(`${code}
;globalThis.__P__ = { calcTotal, calcUnitPrice, ADULT_COLLECTION_PRICE, GEMARA_PRICE, USB_PRICE,
  FREE_USB_MIN_FILES, BUNDLE_ONLY_CATEGORY_NAME, BUNDLE_ONLY_PRICE, FULL_LIBRARY_PRICE };`, sandbox, { filename: 'js/data.js' });
  return sandbox.__P__;
}

const P = loadPricing();

const round2 = n => Math.round(n * 100) / 100;

// stories: [{ id, categoryName }] — רק סיפורים מהקטלוג החי (נבדק אצל הקורא).
// מחזיר { subtotal, usbAmount (null = בלי USB, 0 = חינם), total, itemPrices: Map(id → מחיר) }.
function computeOrderPrice({ product, stories = [], useUsb }) {
  let subtotal = 0;
  const itemPrices = new Map();

  if (product === 'ADULT_COLLECTION') {
    subtotal = P.ADULT_COLLECTION_PRICE;
  } else if (product === 'GEMARA') {
    subtotal = P.GEMARA_PRICE;
  } else {
    const bundle = stories.filter(s => s.categoryName === P.BUNDLE_ONLY_CATEGORY_NAME);
    const regular = stories.filter(s => s.categoryName !== P.BUNDLE_ONLY_CATEGORY_NAME);
    const regularTotal = P.calcTotal(regular.length);
    const bundleTotal = bundle.length ? P.BUNDLE_ONLY_PRICE : 0;
    subtotal = regularTotal + bundleTotal;
    for (const s of regular) itemPrices.set(s.id, round2(regularTotal / regular.length));
    for (const s of bundle) itemPrices.set(s.id, round2(bundleTotal / bundle.length));
  }

  const filesCount = product === 'STORY_SELECTION' || !product ? stories.length : 0;
  const usbFree = product === 'ADULT_COLLECTION' || product === 'GEMARA' || filesCount >= P.FREE_USB_MIN_FILES;
  const usbAmount = useUsb ? (usbFree ? 0 : P.USB_PRICE) : null;

  subtotal = round2(subtotal);
  return { subtotal, usbAmount, total: round2(subtotal + (usbAmount || 0)), itemPrices };
}

function amountsEqual(a, b) {
  return Math.abs(Number(a) - Number(b)) < 0.005;
}

module.exports = { computeOrderPrice, amountsEqual, pricing: P };
