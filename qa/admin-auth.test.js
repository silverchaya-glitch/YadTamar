// בדיקות על אימות האדמין (JWT + bcrypt אמיתיים, לא stub — ADR-005 הוחלף ב-2026-06-28).
// לא כותב שום דבר לטבלאות עסקיות — רק מתחבר/מתנתק ושולח בקשות read-only.
// דורש ADMIN_EMAIL/ADMIN_PASSWORD אמיתיים מ-.env (אותם אלה שה-אדמין האמיתי משתמש בהם).
const assert = require('assert/strict');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const jwt = require('jsonwebtoken');
const { createSuite } = require('./lib/runner');
const { request } = require('./lib/http');

const suite = createSuite('qa/admin-auth.test.js');

const PROTECTED = ['/api/admin/me', '/api/admin/kpi', '/api/admin/orders', '/api/admin/leads'];

async function main() {
  if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) {
    suite.skip('כל הקובץ', 'ADMIN_EMAIL/ADMIN_PASSWORD חסרים ב-.env — אי אפשר לבדוק login אמיתי');
    suite.finish();
    return;
  }

  for (const p of PROTECTED) {
    await suite.test(`GET ${p} בלי עוגייה מחזיר 401`, async () => {
      const { status } = await request(p);
      assert.equal(status, 401);
    });
  }

  await suite.test('GET /api/admin/me עם עוגייה מזויפת (לא JWT תקין) מחזיר 401 "טוקן לא תקין"', async () => {
    const { status, body } = await request('/api/admin/me', { cookie: 'admin_token=garbage-not-a-jwt' });
    assert.equal(status, 401);
    assert.equal(body?.error, 'טוקן לא תקין');
  });

  await suite.test('POST /api/admin/login עם סיסמה שגויה מחזיר 401 בלי חשיפת קיום המשתמש', async () => {
    const { status, body } = await request('/api/admin/login', {
      method: 'POST',
      body: { email: process.env.ADMIN_EMAIL, password: 'definitely-wrong-password-qa' },
    });
    assert.equal(status, 401);
    assert.equal(body?.error, 'שם משתמש או סיסמה שגויים');
  });

  let sessionCookie;
  await suite.test('POST /api/admin/login עם פרטים נכונים מחזיר 200 וקובע עוגיית admin_token', async () => {
    const { status, body, cookie } = await request('/api/admin/login', {
      method: 'POST',
      body: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD },
    });
    assert.equal(status, 200);
    assert.equal(body?.ok, true);
    assert.ok(cookie && cookie.startsWith('admin_token='), 'לא התקבלה עוגיית admin_token');
    sessionCookie = cookie;
  });

  await suite.test('GET /api/admin/me עם העוגייה שהתקבלה מחזיר 200', async () => {
    if (!sessionCookie) throw new Error('אין עוגיה מהבדיקה הקודמת — login נכשל');
    const { status, body } = await request('/api/admin/me', { cookie: sessionCookie });
    assert.equal(status, 200);
    assert.equal(body?.email, process.env.ADMIN_EMAIL);
  });

  await suite.test('POST /api/admin/logout מחזיר 200', async () => {
    if (!sessionCookie) throw new Error('אין עוגיה מהבדיקה הקודמת — login נכשל');
    const { status } = await request('/api/admin/logout', { method: 'POST', cookie: sessionCookie });
    assert.equal(status, 200);
  });

  await suite.test('פער ידוע: אחרי logout, עוגייה ישנה עדיין מתאמתת (JWT ללא blacklist בצד שרת)', async () => {
    // logout מנקה את העוגייה רק בדפדפן (clearCookie בתגובה) — אין מנגנון invalidation
    // בצד שרת (JWT stateless, תוקף 8 שעות). זו נקודה ששווה security review, לא באג QA.
    if (!sessionCookie) throw new Error('אין עוגיה מהבדיקה הקודמת — login נכשל');
    const { status } = await request('/api/admin/me', { cookie: sessionCookie });
    assert.equal(status, 200,
      'אם זה עכשיו 401 — מישהו הוסיף invalidation בצד שרת, כדאי לעדכן את התיעוד/הבדיקה הזו');
  });

  if (process.env.JWT_SECRET) {
    await suite.test('GET /api/admin/me עם טוקן שפג תוקפו מחזיר 401 "הפעלה פגה"', async () => {
      // חותם טוקן שפג תוקפו כבר (exp בעבר) עם אותו JWT_SECRET — לא צריך לשלוט בשעון השרת.
      const expired = jwt.sign({ role: 'admin' }, process.env.JWT_SECRET, { expiresIn: -10 });
      const { status, body } = await request('/api/admin/me', { cookie: `admin_token=${expired}` });
      assert.equal(status, 401);
      assert.equal(body?.error, 'הפעלה פגה — יש להתחבר מחדש');
    });
  } else {
    suite.skip('טוקן שפג תוקפו (TokenExpiredError)', 'JWT_SECRET חסר ב-.env');
  }

  suite.finish();
}

main().catch(err => {
  console.error(`qa/admin-auth.test.js | FATAL | ${err.message}`);
  process.exitCode = 1;
});
