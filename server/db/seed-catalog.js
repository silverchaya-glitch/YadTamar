// זריעת נתונים אמיתיים: קטגוריות, סיפורים, מדרגות תמחור.
// המקור: js/data.js (נטען כפי שהוא דרך vm, בלי לשנות אותו) + files/list_from_drive.csv
// להרצה: node server/db/seed-catalog.js

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { Pool } = require('pg');

const ROOT = path.join(__dirname, '..', '..');

function loadDataJs() {
  // js/data.js משתמש ב-const ברמה עליונה, שלא הופך ל-property על ה-sandbox
  // דרך vm.runInContext; לכן מוסיפים שורת export לאותו script text כדי לתפוס
  // את אותם ה-bindings הלקסיקליים (בלי לגעת בקובץ המקורי).
  const code = fs.readFileSync(path.join(ROOT, 'js', 'data.js'), 'utf8');
  const exportLine = '\n;globalThis.__EXPORTS__ = { CATEGORIES, STORIES, PRICING_RULES };';
  const sandbox = { globalThis: undefined };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code + exportLine, sandbox, { filename: 'js/data.js' });
  return sandbox.__EXPORTS__;
}

// פרסר CSV מינימלי (RFC4180: שדות מצוטטים, פסיקים/גרשיים בפנים)
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c === '\r') { /* skip */ }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift();
  return rows.filter(r => r.length === header.length).map(r =>
    Object.fromEntries(header.map((h, idx) => [h, r[idx]]))
  );
}

function loadDriveIdsByNumber() {
  const csvPath = path.join(ROOT, 'files', 'list_from_drive.csv');
  const text = fs.readFileSync(csvPath, 'utf8');
  const rows = parseCsv(text);
  const map = new Map();
  for (const r of rows) {
    const m = /^(\d+)\s+.*\.mp3$/.exec((r['שם קובץ'] || '').trim());
    if (m) map.set(parseInt(m[1], 10), r['ID']);
  }
  return map;
}

async function main() {
  const { CATEGORIES, STORIES, PRICING_RULES } = loadDataJs();
  const driveIds = loadDriveIdsByNumber();
  console.log(`נטענו ${CATEGORIES.length} קטגוריות, ${STORIES.length} סיפורים, ${PRICING_RULES.length} מדרגות תמחור, ${driveIds.size} Drive IDs`);

  const pool = new Pool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const categoryIdByCode = new Map();
    for (const cat of CATEGORIES) {
      const { rows } = await client.query(
        `INSERT INTO categories (name, display_order, is_active) VALUES ($1,$2,true) RETURNING id`,
        [cat.name, cat.displayOrder]
      );
      categoryIdByCode.set(cat.id, rows[0].id);
    }

    let realDriveCount = 0, placeholderCount = 0;
    for (const story of STORIES) {
      const numMatch = /^s(\d+)$/.exec(story.id);
      const num = numMatch ? parseInt(numMatch[1], 10) : null;
      const driveId = num !== null && driveIds.has(num)
        ? driveIds.get(num)
        : `PENDING-DRIVE-ID-${story.storyCode}`;
      if (driveId.startsWith('PENDING-DRIVE-ID-')) placeholderCount++; else realDriveCount++;

      await client.query(
        `INSERT INTO stories (story_code, category_id, title, google_drive_file_id, duration_seconds, is_active)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          story.storyCode,
          categoryIdByCode.get(story.categoryId),
          story.title,
          driveId,
          story.duration ? story.duration * 60 : null,
          story.isActive,
        ]
      );
    }

    for (const rule of PRICING_RULES) {
      await client.query(
        `INSERT INTO pricing_rules (minimum_quantity, maximum_quantity, unit_price, is_active)
         VALUES ($1,$2,$3,true)`,
        [rule.min, Number.isFinite(rule.max) ? rule.max : null, rule.unitPrice]
      );
    }

    await client.query('COMMIT');
    console.log(`הושלם. Drive ID אמיתי: ${realDriveCount}, placeholder זמני: ${placeholderCount}`);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
