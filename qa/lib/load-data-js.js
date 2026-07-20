// טוען את js/data.js כפי שהוא (בלי לשנות את הקובץ) ומחזיר את ה-bindings הלקסיקליים
// שלו — אותו טריק vm בדיוק שכבר קיים ב-server/db/seed-catalog.js, מורחב כדי לחשוף
// גם את מנוע התמחור ואת שאר הקבועים שבדיקות ה-QA צריכות.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');

function loadDataJs() {
  const code = fs.readFileSync(path.join(ROOT, 'js', 'data.js'), 'utf8');
  const exportLine = `
;globalThis.__EXPORTS__ = {
  CATEGORIES, STORIES, PRICING_RULES, ADULT_DISCS,
  FULL_LIBRARY_PRICE, ADULT_COLLECTION_PRICE, USB_PRICE, FREE_USB_MIN_FILES, TOTAL_STORIES,
  calcUnitPrice, calcTotal,
};`;
  const sandbox = { globalThis: undefined };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code + exportLine, sandbox, { filename: 'js/data.js' });
  return sandbox.__EXPORTS__;
}

module.exports = { loadDataJs };
