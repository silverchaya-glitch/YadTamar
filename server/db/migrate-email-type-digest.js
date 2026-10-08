// מיגרציה חד-פעמית: מוסיפה את סוג המייל DAILY_PAYMENTS_DIGEST (סיכום יומי של עסקאות
// אשראי למשרד, להשוואה מול פורטל HYP) ל-CHECK של email_logs.email_type. בטוח להריץ שוב.
// להרצה: node server/db/migrate-email-type-digest.js

require('dotenv').config();
const { Pool } = require('pg');

async function main() {
  const pool = new Pool();
  try {
    await pool.query(`
      ALTER TABLE email_logs DROP CONSTRAINT IF EXISTS email_logs_email_type_check;
      ALTER TABLE email_logs ADD CONSTRAINT email_logs_email_type_check CHECK (email_type IN
        ('PURCHASE_CONFIRMATION','FILE_DELIVERY','GIFT_STORY','OFFICE_NOTIFICATION','ERROR_NOTIFICATION','DAILY_PAYMENTS_DIGEST'));
    `);
    console.log('הושלם: DAILY_PAYMENTS_DIGEST נוסף ל-email_logs_email_type_check');
  } finally {
    await pool.end();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
