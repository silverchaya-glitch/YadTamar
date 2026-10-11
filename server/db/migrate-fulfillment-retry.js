// מיגרציה חד-פעמית: עמודות לתור הניסיונות החוזרים של המסירה (server/services/fulfillment-queue.js).
// next_retry_at — מתי לנסות שוב (NULL = לא בתור). retry_count — כמה ניסיונות התור עשה.
// alert_sent_at — מתי נשלחה למשרד התראה שכל הניסיונות נכשלו. הזמנות ישנות נשארות
// עם next_retry_at=NULL ולא נכנסות לתור. בטוח להריץ שוב.
// להרצה: node server/db/migrate-fulfillment-retry.js

require('dotenv').config();
const { Pool } = require('pg');

async function main() {
  const pool = new Pool();
  try {
    await pool.query(`
      ALTER TABLE fulfillment_requests ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE fulfillment_requests ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ;
      ALTER TABLE fulfillment_requests ADD COLUMN IF NOT EXISTS alert_sent_at TIMESTAMPTZ;
      CREATE INDEX IF NOT EXISTS idx_fulfillment_next_retry ON fulfillment_requests (next_retry_at) WHERE next_retry_at IS NOT NULL;
    `);
    console.log('הושלם: retry_count/next_retry_at/alert_sent_at נוספו ל-fulfillment_requests');
  } finally {
    await pool.end();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
