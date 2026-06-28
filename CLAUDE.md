# CLAUDE.md — יד תמר

## Repo Summary

יד תמר — חנות דיגיטלית לסיפורי שמע לילדים. 428 סיפורים לילדים (c1–c7) ו-24 דיסקים לאוסף מבוגרים. אתר סטטי לחלוטין: HTML/CSS/JS בלבד, ללא backend, ללא build system, ללא package manager. שתי דפים: חנות (`index.html`) ופאנל ניהול (`admin.html`), שניהם משתפים שכבת נתונים ב-`js/data.js`. גרסה נוכחית: MVP 1.1.

## Running

```bash
python3 -m http.server 8080 --directory /www/YadTamar
# http://localhost:8080 → store   |   http://localhost:8080/admin.html → admin
```

## Golden Rules

1. **אל תוסיף build step או package manager** — האתר סטטי במכוון. npm/webpack/TypeScript אסורים.
2. **index.html ו-admin.html משתמשים בצבעים שונים לאותם שמות משתנים** — קרא `CLAUDE/architecture.md` לפני כל עריכת CSS.
3. **JS inline בכל HTML** — לוגיקה של החנות נשמרת ב-index.html, לוגיקה של הניהול ב-admin.html. `js/data.js` בלבד הוא קובץ JS חיצוני.
4. **כל טקסט למשתמש בעברית** — `dir="rtl"` על `<html>`, `direction: rtl` על `body`.
5. **הוספת סיפור = שורה ב-`_RAW` ב-data.js בלבד** — אל תשנה מבנה נתונים אחר.
6. **PROGRESS.txt הוא append-only** — לעולם אל תמחק שם תוכן; רק הוסף בסוף.
7. **לפני שינוי ב-data.js** — בדוק שההשפעה על שני הדפים נבדקה (שניהם טוענים את הקובץ).
8. **login של admin הוא stub MVP** — אל תסמוך עליו לאבטחה; ראה BACKLOG.

## Detail-Doc Index

| נושא | קובץ | מתי לקרוא |
|---|---|---|
| מבנה האפליקציה, שכבת הנתונים, שני ה-CSS themes | `CLAUDE/architecture.md` | לפני כל שינוי מבני או שינוי CSS |
| החלטות ארכיטקטורה (ADR-001–005) | `CLAUDE/decisions.md` | כשתוהה "למה הדברים כך?" |
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
| `TOTAL_STORIES` | 428 |

## Snapshot Files

קבצים עם prefix `_` או `_snap_` הם עיצובי ייחוס בלבד — לא דפים פעילים.
