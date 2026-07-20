# qa/ — בדיקות QA ליד תמר

## אזהרה מרכזית: אין סביבת staging

`QA_BASE_URL` (ברירת מחדל `http://127.0.0.1:3000`) **הוא production** — אותו תהליך
(`yadtamar.service`), אותו Postgres (`yadtamar`), אותם webhooks חיצוניים אמיתיים.
אין כאן sandbox נפרד. כל בדיקה שמכניסה נתונים כותבת ישירות ל-DB האמיתי.

## שכבות סיכון

| קובץ | סיכון | רץ ב-`node qa/run.js`? | מה הוא עושה |
|---|---|---|---|
| `catalog.test.js` | אין (read-only) | כן | בודק את `GET /api/catalog` מול `js/data.js` |
| `pricing.test.js` | אין (לוגיקה טהורה, בלי רשת) | כן | טוען את `js/data.js` דרך `vm` ובודק מדרגות תמחור/USB |
| `admin-auth.test.js` | נמוך (login/logout אמיתיים, בלי כתיבה עסקית) | כן | מאמת JWT+bcrypt אמיתי מול `ADMIN_EMAIL`/`ADMIN_PASSWORD` |
| `negative.test.js` | נמוך (רק בקשות שנעצרות ב-400 לפני DB) | כן | מקרי קצה — שדות חסרים, ערכים לא תקינים |
| `orders-mutating.test.js` | **בינוני** — כותב הזמנת ADULT_COLLECTION אמיתית ל-Postgres | **לא** | מתויג `demo.*`; מאומת בקוד שהוא לא נוגע ב-webhook Drive |
| `orders-fulfillment-webhook.test.js` | **גבוה** — יוצר תיקיית Drive אמיתית + שיתוף אמיתי | **לא** | הבדיקה העיקרית לפי בקשת המשתמש — ראה אזהרה בקובץ עצמו |
| `payment-hyp-sandbox.test.js` | **בינוני-גבוה** — כותב הזמנת ADULT_COLLECTION+CREDIT_CARD אמיתית, קורא ל-`/api/payment/*` | **לא** | מסרב לרוץ אם `HYP_SANDBOX` אינו `'true'`; זרימת webhook מלאה תלויה ב-`HYP_WEBHOOK_SECRET` (TBD) |

## הרצה

```bash
node qa/run.js                 # רק השכבות הבטוחות, תמיד מותר
```

בדיקת המילוי האמיתי (הבדיקה העיקרית, לפי בקשת המשתמש) — **כותבת ל-DB האמיתי ויוצרת
תיקיית Drive אמיתית בכל הרצה**:

```bash
QA_ALLOW_MUTATIONS=1 node qa/orders-mutating.test.js
QA_ALLOW_MUTATIONS=1 QA_ALLOW_FULFILLMENT_WEBHOOK=1 node qa/orders-fulfillment-webhook.test.js
QA_ALLOW_MUTATIONS=1 QA_ALLOW_HYP_SANDBOX=1 node qa/payment-hyp-sandbox.test.js   # דורש HYP_SANDBOX=true ב-.env
```

אף script לא קובע את ה-flags האלה לבד — זו החלטה מפורשת בכל הרצה.

## ניקוי

`qa/cleanup.js` הוא כלי **נפרד וידני**, לעולם לא מופעל אוטומטית:

```bash
node qa/cleanup.js             # dry-run — רק מראה מה יימחק
node qa/cleanup.js --confirm   # מוחק בפועל (ידרוש הקלדת "DELETE")
```

מוחק שורות מתויגות `demo.%`/`DEMO-%` מ-`customers`/`orders`/... ומ-`leads`. **לא מוחק
תיקיות Drive אמיתיות** שנוצרו ע"י `orders-fulfillment-webhook.test.js` — לסקריפט אין
גישת Drive API; ה-URL מודפס בסוף הריצה למחיקה ידנית.

## ממצא P0 שהתגלה תוך כדי כתיבת הבדיקות (לא תוקן, מדווח בנפרד)

זריקת שגיאה בתוך handler אסינכרוני ב-Express 4 בלי `try/catch` **מפילה את כל תהליך
ה-Node** (unhandled rejection), לא רק מחזירה שגיאה לבקשה הבודדת. אומת בסביבה מבודדת
(לא מול production). זה חל לפחות על:

- `GET /api/orders/:id` (`server/routes/orders.js:24`) — מזהה לא-UUID יגרום ל-pg
  לזרוק, ה-handler לא תופס, התהליך קורס.
- `PATCH /api/admin/orders/:id` ו-endpoints נוספים ב-`server/routes/admin.js`
  (כמעט כולם ללא `try/catch`).

`yadtamar.service` מוגדר `Restart=always`/`RestartSec=3`, אז זו הפרעת שירות של כמה
שניות, לא קריסה קבועה — אבל זה עדיין וקטור DoS אמיתי על production חי. בגלל זה
`qa/negative.test.js` **מדלג בכוונה** על הבדיקה הזו (`suite.skip`) במקום להריץ אותה,
ו`qa/orders-mutating.test.js` מדלג על בדיקת ה-trigger `prevent_paid_to_pending` מאותה
סיבה בדיוק. תיקון (`try/catch` סביב `await db.X(...)` בראוטים האלה) הוא באג נפרד
שכדאי לתקן — לא נוגע כאן, רק מדווח.
