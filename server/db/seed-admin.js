// יוצר/מעדכן את משתמש האדמין היחיד (MVP) בטבלת admin_users, מתוך .env.
// זה אינו נתון דמה — זהו חשבון האדמין האמיתי; ה-hash נוצר מ-ADMIN_EMAIL/ADMIN_PASSWORD.
// להרצה: node server/db/seed-admin.js

require('dotenv').config();
const bcrypt = require('bcrypt');
const { Pool } = require('pg');

async function main() {
  const { ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    throw new Error('ADMIN_EMAIL / ADMIN_PASSWORD חסרים ב-.env');
  }
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
  const pool = new Pool();
  try {
    await pool.query(
      `INSERT INTO admin_users (email, password_hash, is_active)
       VALUES ($1, $2, true)
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
      [ADMIN_EMAIL, passwordHash]
    );
    console.log(`משתמש אדמין נוצר/עודכן: ${ADMIN_EMAIL}`);
  } finally {
    await pool.end();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
