// מיגרציה חד-פעמית: הוספת עמודת gate לטבלת stories הקיימת (DB חי, לא ניתן להריץ seed-catalog.js מחדש
// כי הוא INSERT בלבד ויתנגש ב-UNIQUE story_code / יכפיל קטגוריות). לא נוגע ב-orders/order_items.
// המקור: js/data.js (נטען כמו ב-seed-catalog.js, בלי לשנות אותו).
// להרצה: node server/db/migrate-add-gate.js

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { Pool } = require('pg');

const ROOT = path.join(__dirname, '..', '..');

function loadDataJs() {
  const code = fs.readFileSync(path.join(ROOT, 'js', 'data.js'), 'utf8');
  const exportLine = '\n;globalThis.__EXPORTS__ = { STORIES };';
  const sandbox = { globalThis: undefined };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code + exportLine, sandbox, { filename: 'js/data.js' });
  return sandbox.__EXPORTS__;
}

async function main() {
  const { STORIES } = loadDataJs();
  const withGate = STORIES.filter(s => s.gate);
  console.log(`נטענו ${STORIES.length} סיפורים מ-data.js, מתוכם ${withGate.length} עם שדה gate`);

  const pool = new Pool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`ALTER TABLE stories ADD COLUMN IF NOT EXISTS gate TEXT`);

    let updated = 0;
    for (const story of withGate) {
      const { rowCount } = await client.query(
        `UPDATE stories SET gate = $1 WHERE story_code = $2`,
        [story.gate, story.storyCode]
      );
      updated += rowCount;
    }

    await client.query('COMMIT');
    console.log(`הושלם. עודכנו ${updated} שורות (מתוך ${withGate.length} צפויות).`);
    if (updated !== withGate.length) {
      console.warn('שים לב: מספר השורות שעודכנו שונה ממספר הסיפורים עם gate ב-data.js — ייתכן שיש story_code שלא קיים ב-DB.');
    }
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
