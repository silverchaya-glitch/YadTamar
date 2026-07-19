# Conventions

## Language & Direction

- All user-facing strings are in **Hebrew**
- `<html lang="he" dir="rtl">` on every page
- CSS `direction: rtl` on `body`
- Font: **Heebo** from Google Fonts (weights 300–900)
- Never add LTR-only layout assumptions (flexbox row, margins, etc.) — verify RTL behavior

## CSS Variables

Since ADR-007 (2026-07-15), index.html and admin.html share the **same** variable values — a single unified theme. Read `CLAUDE/architecture.md` for the full table. The values still live in two places — keep them in sync when editing either:

**In index.html** — edit the inline `<style>` block at the top of the file:
```css
--teal: #00B4CC
--teal-dk: #007A8C
--teal-lt: #E0F7FA
--gold: #F5C518
--pink: #E91E8C
--radius: 16px
```

**In admin.html** — edit `css/main.css` (same values):
```css
--teal: #00B4CC
--teal-dk: #007A8C
--teal-lt: #E0F7FA
--gold: #F5C518
--pink: #E91E8C
--radius: 16px
```

## ID Conventions

| Item | ID Format | Example |
|---|---|---|
| Children's stories | `s` + channel number | `s1`, `s42`, `s433` |
| Gemara stories | `sgG` + 3-digit number | `sgG001`, `sgG005` |
| Adult discs | `ad` + 2-digit number | `ad01`, `ad24` |
| Categories | `c` + number | `c1`–`c18` |

## Adding a Story

Append one row to `_RAW` in `js/data.js`:
```js
[channelNum, 'c1', 'שם הסיפור', 50],
// [channelNum, categoryId, title, durationMin]
```
**עדכון (2026-07-16):** Story code הוא כעת המספר הסידורי בלבד (`"114"`), **בלי** קידומת — הוסרה הקידומת `YT-` שהייתה קיימת קודם ולא תאמה שום דבר בקובץ המקור (`files/list_from_drive.csv`).

**Category IDs (מתואם במדויק ל-`files/list_from_drive.csv`, אומת שורה-שורה מול 433 הפריטים):**

| id | שם | טווח מספר סידורי | כמות |
|---|---|---|---|
| c1 | סיפורי חז"ל ותיקון המידות | 1–81 | 81 |
| c2 | מעגל השנה | 82–113 | 32 |
| c3 | ספר בראשית | 114–141 | 28 |
| c4 | ספר שמות | 142–154 | 13 |
| c5 | ספר יהושע | 155–163 | 9 |
| c6 | ספר שופטים | 164–176 | 13 |
| c7 | ספר שמואל א' | 177–189 | 13 |
| c8 | ספר שמואל ב' | 190–202 | 13 |
| c9 | ספר מלכים א' | 203–214 | 12 |
| c10 | ספר מלכים ב' | 215–226 | 12 |
| c11 | סיפורי מופת - סדרה א' | 227–259 | 33 |
| c12 | סיפורי מופת - סדרה ב' | 260–292 | 33 |
| c13 | סיפורי מופת - סדרה ג' | 293–325 | 33 |
| c14 | סיפורי מופת - סדרה ד' | 401–433 | 33 |
| c15 | ילדים מספרים בשולחן שבת | 326–347 | 22 |
| c16 | בר מצוה/בת מצוה | 348–358 | 11 |
| c17 | ספר במדבר | 359–400 | 42 |
| c18 | גמרא (לא חלק מה-CSV, 5 פריטים נפרדים ב-`_GEMARA`) | — | 5 |

כשמוסיפים סיפור חדש שאינו קיים בקובץ המקור — יש לבחור את הקטגוריה המתאימה מהרשימה לפי תוכן הסיפור, ולעדכן את הטווח בתיעוד אם הוא משנה את גבולות הטווח הקיים.

## Code Style

- No build step, no package manager — **ever**
- No npm, no webpack, no TypeScript transpilation
- JS goes inline in the relevant HTML file (not a new `.js` file), except shared data which goes in `js/data.js`
- New CSS for index.html → inline `<style>` block; new CSS for admin.html → `css/main.css`
- Comment blocks in Hebrew are acceptable; code comments in English

## File Naming

- Snapshot/wireframe files: prefix with `_` or `_snap_` — these are reference designs, not active pages
- Active pages: `index.html`, `admin.html`
- Shared data: `js/data.js`
- Shared admin styles: `css/main.css`
