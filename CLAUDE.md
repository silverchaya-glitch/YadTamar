# CLAUDE.md — יד תמר

## Repo Summary

יד תמר — חנות דיגיטלית לסיפורי שמע לילדים. 433 סיפורים לילדים (c1–c17, מתואם במדויק לקובץ המקור `files/list_from_drive.csv`) + 5 קבצי גמרא (c18) = 438 סיפורים בסה"כ, ו-24 דיסקים לאוסף מבוגרים. אתר סטטי לחלוטין: HTML/CSS/JS בלבד, ללא backend, ללא build system, ללא package manager. שתי דפים: חנות (`index.html`) ופאנל ניהול (`admin.html`), שניהם משתפים שכבת נתונים ב-`js/data.js`. גרסה נוכחית: MVP 1.1.

## Running

**עדכון (2026-07-02):** מאז המעבר ל-PostgreSQL, index.html טוען את הקטלוג מ-`GET /api/catalog` — `python3 -m http.server` הישן **לא מספיק יותר** (אין לו את ה-API, ותופיע השגיאה "שגיאה בטעינת הקטלוג"). יש להריץ את שרת ה-Express, שגם מגיש את הקבצים הסטטיים וגם את ה-API:

```bash
cd /www/YadTamar
node server/index.js
# http://localhost:3000 → store   |   http://localhost:3000/admin.html → admin
```

דורש PostgreSQL רץ ומאותחל (`server/db/schema.sql` + `server/db/seed-*.js`) ו-`.env` מוגדר (ראה `.env.example`). בפריסת production יש להריץ את השרת תחת מפקח תהליכים (pm2/systemd) כדי שיקום לבד אחרי קריסה/ריסטרט — ראה `FOLLOWUPS.md`.

## Golden Rules

1. **אל תוסיף build step או package manager** — האתר סטטי במכוון. npm/webpack/TypeScript אסורים.
2. **index.html ו-admin.html חולקים אותה פלטת CSS (ADR-007), אך עדיין שני מיקומי CSS נפרדים** (`<style>` inline מול `css/main.css`) עם רמת "קלייממורפיזם"/אנימציה שונה בכוונה (ADR-008, מעודכן ב-ADR-009) — קרא `CLAUDE/architecture.md` לפני כל עריכת CSS.
3. **JS inline בכל HTML** — לוגיקה של החנות נשמרת ב-index.html, לוגיקה של הניהול ב-admin.html. `js/data.js` בלבד הוא קובץ JS חיצוני.
4. **כל טקסט למשתמש בעברית** — `dir="rtl"` על `<html>`, `direction: rtl` על `body`.
5. **הוספת סיפור = שורה ב-`_RAW` ב-data.js בלבד** — אל תשנה מבנה נתונים אחר. **עדכון (2026-07-02):** מאז שקטלוג החנות (`index.html`) עבר לטעון מ-`GET /api/catalog` (Postgres, לא `js/data.js`), שורה חדשה ב-`_RAW` מעדכנת את `admin.html` מיד אך **לא** מופיעה בחנות עד שירוץ שוב `node server/db/seed-catalog.js`. ראה `FOLLOWUPS.md`.
6. **PROGRESS.txt הוא append-only** — לעולם אל תמחק שם תוכן; רק הוסף בסוף.
7. **לפני שינוי ב-data.js** — בדוק שההשפעה על שני הדפים נבדקה (שניהם טוענים את הקובץ).
8. **login של admin הוא stub MVP** — אל תסמוך עליו לאבטחה; ראה BACKLOG.

## Git Push

בסביבה הזו (השרת בפועל) אין credential helper/SSH key מוגדר ל-GitHub. האימות נמצא ב-`GITHUB_TOKEN` בקובץ `/www/YadTamar/.env` (הקובץ ב-`.gitignore`, לא נכנס ל-repo). `GITHUB_USER` באותו קובץ ריק בכוונה — לא בשימוש; ה-token עצמו משמש כ-username מול GitHub, בלי סיסמה.

לדחוף בלי להדפיס את הטוקן לצ'אט:

```bash
set -a; source /www/YadTamar/.env; set +a
git push "https://${GITHUB_TOKEN}@github.com/silverchaya-glitch/YadTamar.git" main
```

אל תשתמשי ב-`git remote set-url` עם הטוקן משובץ (זה משאיר את הסוד קבוע ב-`.git/config`) — תמיד להעביר את ה-URL עם הטוקן inline לפקודת ה-push עצמה, חד-פעמי.

## Detail-Doc Index

| נושא | קובץ | מתי לקרוא |
|---|---|---|
| מבנה האפליקציה, שכבת הנתונים, שני ה-CSS themes | `CLAUDE/architecture.md` | לפני כל שינוי מבני או שינוי CSS |
| החלטות ארכיטקטורה (ADR-001–009) | `CLAUDE/decisions.md` | כשתוהה "למה הדברים כך?" |
| קונבנציות: IDs, שמות קבצים, הוספת סיפור | `CLAUDE/conventions.md` | לפני הוספת תוכן או קובץ חדש |
| מצב משימות ו-roadmap | `CLAUDE/tasks.md` | לפני התחלת feature חדש |
| באגים וחוסרים שנמצאו בדרך | `FOLLOWUPS.md` | בתחילת כל session |
| features נדחים | `BACKLOG.md` | כשמציעים רעיון חדש |
| יומן שינויים | `PROGRESS.txt` | אחרי כל שינוי משמעותי — הוסף שורה |

## Key Constants (quick ref)

| Constant | Value |
|---|---|
| `FULL_LIBRARY_PRICE` | 1550 |
| `ADULT_COLLECTION_PRICE` | 360 |
| `USB_PRICE` | 15 |
| `FREE_USB_MIN_FILES` | 50 |
| `TOTAL_STORIES` | 438 |

## Snapshot Files

קבצים עם prefix `_` או `_snap_` הם עיצובי ייחוס בלבד — לא דפים פעילים.
