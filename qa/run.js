// מריץ רק את השכבות הבטוחות (read-only / לוגיקה טהורה) — לעולם לא נוגע ב-
// qa/orders-mutating.test.js או qa/orders-fulfillment-webhook.test.js, שדורשים
// הפעלה ידנית מפורשת עם flags נפרדים (ראה qa/README.md).
// הרצה: node qa/run.js
const { spawnSync } = require('child_process');
const path = require('path');

const SAFE_FILES = [
  'catalog.test.js',
  'pricing.test.js',
  'admin-auth.test.js',
  'negative.test.js',
];

let anyFailed = false;

for (const file of SAFE_FILES) {
  console.log(`\n=== ${file} ===`);
  const result = spawnSync(process.execPath, [path.join(__dirname, file)], { stdio: 'inherit' });
  if (result.status !== 0) anyFailed = true;
}

console.log(`\n=== סיכום ריצה בטוחה (${SAFE_FILES.length} קבצים) ===`);
console.log(anyFailed ? 'יש כשלים — ראו פירוט למעלה.' : 'הכל עבר.');
console.log('לבדיקות שכותבות נתונים (סיכון גבוה, לא רצו כרגע): ראו qa/README.md.');

process.exitCode = anyFailed ? 1 : 0;
