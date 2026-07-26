// טוען את הלוגיקה הטהורה (לא-DOM) של ה-<script> הראשי ב-index.html + js/data.js,
// באותה טכניקת vm בדיוק כמו qa/lib/load-data-js.js — לא Playwright/Puppeteer, שום
// תלות npm חדשה (CLAUDE.md כלל 1, האתר סטטי בכוונה). ה-<script> של index.html
// נוגע ב-document/window ברמת top-level רק בשורה אחת: רישום ה-DOMContentLoaded
// listener (לא מופעל כאן) — ולכן מספיק stub מינימלי של document.addEventListener.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');

function loadStoreLogic() {
  const dataJs = fs.readFileSync(path.join(ROOT, 'js', 'data.js'), 'utf8');
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
  if (!scriptMatch) throw new Error('לא נמצא <script> ראשי ב-index.html — יתכן שהמבנה השתנה');

  const exportLine = `
;globalThis.__EXPORTS__ = {
  getSelectionBreakdown, getSelectionTotal, state,
  BUNDLE_ONLY_PRICE, BUNDLE_ONLY_CATEGORY_NAME,
  setLiveCatalog: (categories, stories) => {
    liveCategories = categories;
    liveStories = stories;
    BUNDLE_ONLY_CATEGORY_ID = liveCategories.find(c => c.name === BUNDLE_ONLY_CATEGORY_NAME)?.id || null;
  },
  getBundleOnlyCategoryId: () => BUNDLE_ONLY_CATEGORY_ID,
};`;

  const sandbox = {
    globalThis: undefined,
    document: { addEventListener() {} },
    window: undefined,
    console,
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(dataJs + '\n' + scriptMatch[1] + exportLine, sandbox, { filename: 'index.html:inline-script' });
  return sandbox.__EXPORTS__;
}

module.exports = { loadStoreLogic };
