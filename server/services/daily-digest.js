// סיכום יומי למשרד של עסקאות האשראי שאושרו אתמול — להשוואה מול רשימת העסקאות בפורטל
// HYP. זו הבקרה על חזרות מזויפות: במסוף שלנו פרמטר האימות הוא PassP (החלטת הבעלים
// 2026-10-08), ולכן אין VERIFY. טיימר בתוך התהליך (לא cron — אין build/infra נוסף);
// בודק כל 10 דקות, שולח מ-08:00 (שעון השרת, Asia/Jerusalem) אם עוד לא נשלח היום.
// שליחה מוצלחת נרשמת ב-email_logs (DAILY_PAYMENTS_DIGEST), כך שריסטרט לא שולח פעמיים.
const db = require('../db');
const { sendDailyPaymentsDigest } = require('./email');

const SEND_HOUR = 8;
const CHECK_INTERVAL_MS = 10 * 60 * 1000;

let running = false;

async function maybeSendDigest(now = new Date()) {
  if (running || now.getHours() < SEND_HOUR) return;
  running = true;
  try {
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (await db.hasEmailLog('DAILY_PAYMENTS_DIGEST', todayStart)) return;
    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    const rows = await db.getApprovedCardPayments(yesterdayStart, todayStart);
    const dateLabel = yesterdayStart.toLocaleDateString('he-IL');
    const result = await sendDailyPaymentsDigest({ dateLabel, rows });
    console.log(`[digest] daily payments digest for ${dateLabel}: ${rows.length} rows, ${result.success ? 'sent' : 'FAILED — ' + result.error}`);
  } catch (e) {
    console.error(`[digest] failed: ${e.message}`);
  } finally {
    running = false;
  }
}

function startDailyDigest() {
  setTimeout(maybeSendDigest, 60 * 1000).unref();
  setInterval(maybeSendDigest, CHECK_INTERVAL_MS).unref();
}

module.exports = { startDailyDigest, maybeSendDigest };
