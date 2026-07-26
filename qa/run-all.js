// מריץ את כל qa/*.test.js (בלי חריגים, בלי רשימה מקודדת) — כל קובץ כבר בודק בעצמו
// אם ה-flags הנדרשים (QA_ALLOW_MUTATIONS/QA_ALLOW_LOAD_TEST/QA_ALLOW_FULFILLMENT_WEBHOOK/
// QA_ALLOW_HYP_SANDBOX) מוגדרים, ומדפיס SKIPPED אם לא. run-all.js עצמו **לעולם לא
// קובע flag בעצמו** — רק קורא את מה שכבר מוגדר בסביבה כשמריצים אותו, בדיוק כמו כל
// שאר הסקריפטים ב-qa/ (ראה qa/README.md).
//
// בנוסף ל-node qa/run.js (שרץ רק את השכבה הבטוחה ומדפיס ל-console בלבד), הסקריפט
// הזה: (1) שומר דוח מלא וקריא לקובץ ב-qa/reports/, (2) שולח מייל סיכום מקוצר עם
// טבלת pass/fail/skip לכל קובץ ל-silver.chaya@gmail.com, כולל הפניה לקובץ הדוח
// המלא (ראה qa/lib/mailer.js).
//
// הרצה (בדוגמה: כל השכבות, כולל המתויגות):
//   QA_ALLOW_MUTATIONS=1 QA_ALLOW_LOAD_TEST=1 QA_ALLOW_FULFILLMENT_WEBHOOK=1 node qa/run-all.js
// הרצה בלי flags = בדיוק כמו node qa/run.js (רק השכבה הבטוחה), אבל גם עם דוח+מייל.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { sendQaReport } = require('./lib/mailer');

const QA_DIR = __dirname;
const REPORTS_DIR = path.join(QA_DIR, 'reports');

const SUMMARY_RE = /^(.+?) \| SUMMARY \| (\d+) passed, (\d+) failed, (\d+) skipped$/m;
const SKIPPED_RE = /\| SKIPPED \|/;

function listTestFiles() {
  return fs.readdirSync(QA_DIR)
    .filter(f => f.endsWith('.test.js'))
    .sort();
}

function runSuite(file) {
  const result = spawnSync(process.execPath, [path.join(QA_DIR, file)], {
    encoding: 'utf8',
    env: process.env,
  });
  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  const combined = stdout + (stderr ? `\n[stderr]\n${stderr}` : '');

  const summaryMatch = stdout.match(SUMMARY_RE);
  const wasSkippedEntirely = !summaryMatch && SKIPPED_RE.test(stdout);

  let passed = 0, failed = 0, skipped = 0, verdict;
  if (summaryMatch) {
    passed = Number(summaryMatch[2]);
    failed = Number(summaryMatch[3]);
    skipped = Number(summaryMatch[4]);
    verdict = failed > 0 ? 'FAIL' : 'PASS';
  } else if (wasSkippedEntirely) {
    verdict = 'SKIPPED';
  } else if (result.status !== 0) {
    verdict = 'FATAL';
  } else {
    verdict = 'PASS'; // אין תוצאות/SUMMARY אבל exit code 0 — לא אמור לקרות, אבל לא כישלון
  }

  return { file, verdict, passed, failed, skipped, exitCode: result.status, output: combined };
}

function buildReportMarkdown(suiteResults, startedAt, finishedAt) {
  const lines = [];
  lines.push(`# דוח QA — יד תמר`);
  lines.push('');
  lines.push(`התחלה: ${startedAt.toLocaleString('he-IL')}`);
  lines.push(`סיום: ${finishedAt.toLocaleString('he-IL')}`);
  lines.push('');
  lines.push('| קובץ | תוצאה | עברו | נכשלו | דולגו |');
  lines.push('|---|---|---|---|---|');
  for (const r of suiteResults) {
    lines.push(`| ${r.file} | ${r.verdict} | ${r.passed} | ${r.failed} | ${r.skipped} |`);
  }
  lines.push('');
  lines.push('## פירוט מלא לכל קובץ');
  for (const r of suiteResults) {
    lines.push('');
    lines.push(`### ${r.file} — ${r.verdict}`);
    lines.push('```');
    lines.push(r.output.trim() || '(אין פלט)');
    lines.push('```');
  }
  return lines.join('\n');
}

function buildEmailHtml(suiteResults, reportPath, startedAt) {
  const totalPassed = suiteResults.reduce((s, r) => s + r.passed, 0);
  const totalFailed = suiteResults.reduce((s, r) => s + r.failed, 0);
  const totalSkipped = suiteResults.reduce((s, r) => s + r.skipped, 0);
  const anyFail = suiteResults.some(r => r.verdict === 'FAIL' || r.verdict === 'FATAL');

  const rows = suiteResults.map(r => `
    <tr>
      <td style="padding:4px 10px;border:1px solid #ddd">${r.file}</td>
      <td style="padding:4px 10px;border:1px solid #ddd;font-weight:bold;color:${r.verdict === 'PASS' ? '#16a34a' : r.verdict === 'SKIPPED' ? '#6b7280' : '#dc2626'}">${r.verdict}</td>
      <td style="padding:4px 10px;border:1px solid #ddd;text-align:center">${r.passed}</td>
      <td style="padding:4px 10px;border:1px solid #ddd;text-align:center">${r.failed}</td>
      <td style="padding:4px 10px;border:1px solid #ddd;text-align:center">${r.skipped}</td>
    </tr>`).join('');

  return `
    <div dir="rtl" style="font-family:sans-serif">
      <h2>דוח QA — יד תמר (${startedAt.toLocaleString('he-IL')})</h2>
      <p>סה"כ: <strong>${totalPassed}</strong> עברו, <strong>${totalFailed}</strong> נכשלו, <strong>${totalSkipped}</strong> דולגו.</p>
      <table style="border-collapse:collapse">
        <thead>
          <tr style="background:#f3f4f6">
            <th style="padding:4px 10px;border:1px solid #ddd">קובץ</th>
            <th style="padding:4px 10px;border:1px solid #ddd">תוצאה</th>
            <th style="padding:4px 10px;border:1px solid #ddd">עברו</th>
            <th style="padding:4px 10px;border:1px solid #ddd">נכשלו</th>
            <th style="padding:4px 10px;border:1px solid #ddd">דולגו</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="margin-top:16px">לפירוט המלא (כולל כל הפלט, הזמנות דמו שנוצרו וכו'):<br>
      <code>${reportPath}</code></p>
      ${anyFail ? '<p style="color:#dc2626"><strong>⚠️ יש כשלים — יש לעיין בפירוט המלא.</strong></p>' : ''}
    </div>`;
}

async function main() {
  const startedAt = new Date();
  fs.mkdirSync(REPORTS_DIR, { recursive: true });

  const files = listTestFiles();
  const suiteResults = [];

  for (const file of files) {
    console.log(`\n=== ${file} ===`);
    const result = runSuite(file);
    console.log(result.output);
    suiteResults.push(result);
  }

  const finishedAt = new Date();
  const reportFileName = `${startedAt.toISOString().replace(/[:.]/g, '-')}.md`;
  const reportPath = path.join(REPORTS_DIR, reportFileName);
  fs.writeFileSync(reportPath, buildReportMarkdown(suiteResults, startedAt, finishedAt), 'utf8');

  const totalFailed = suiteResults.reduce((s, r) => s + r.failed, 0);
  const anyFail = suiteResults.some(r => r.verdict === 'FAIL' || r.verdict === 'FATAL');
  const totalPassed = suiteResults.reduce((s, r) => s + r.passed, 0);
  const totalSkipped = suiteResults.reduce((s, r) => s + r.skipped, 0);

  console.log(`\n=== סיכום כולל (${files.length} קבצים) ===`);
  console.log(`${totalPassed} עברו, ${totalFailed} נכשלו, ${totalSkipped} דולגו.`);
  console.log(`דוח מלא נשמר ב: ${reportPath}`);

  const subject = `[יד תמר QA] דוח ריצה — ${totalPassed} עברו, ${totalFailed} נכשלו, ${totalSkipped} דולגו — ${anyFail ? '⚠️ יש כשלים' : 'הכל תקין'}`;
  try {
    await sendQaReport({ subject, html: buildEmailHtml(suiteResults, reportPath, startedAt) });
    console.log('מייל סיכום נשלח ל-silver.chaya@gmail.com');
  } catch (err) {
    console.error(`שליחת מייל הסיכום נכשלה: ${err.message} — הדוח המלא עדיין קיים בקובץ שהוזכר למעלה.`);
  }

  process.exitCode = anyFail ? 1 : 0;
}

main().catch(err => {
  console.error(`qa/run-all.js | FATAL | ${err.message}`);
  process.exitCode = 1;
});
