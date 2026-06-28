# Conventions

## Language & Direction

- All user-facing strings are in **Hebrew**
- `<html lang="he" dir="rtl">` on every page
- CSS `direction: rtl` on `body`
- Font: **Heebo** from Google Fonts (weights 300–900)
- Never add LTR-only layout assumptions (flexbox row, margins, etc.) — verify RTL behavior

## CSS Variables

Two separate variable sets exist. Read `CLAUDE/architecture.md` before touching styles.

**In index.html** — edit the inline `<style>` block at the top of the file:
```css
--teal: #6366F1   /* indigo/purple, NOT actual teal */
--teal-dk: #4338CA
--teal-lt: #EEF2FF
--gold: #F59E0B
--pink: #EC4899
```

**In admin.html** — edit `css/main.css`:
```css
--teal: #00B4CC   /* actual teal */
--teal-dk: #007A8C
--teal-lt: #E0F7FA
--gold: #F5C518
--pink: #E91E8C
```

## ID Conventions

| Item | ID Format | Example |
|---|---|---|
| Children's stories | `s` + channel number | `s1`, `s42`, `s433` |
| Gemara stories | `sgG` + 3-digit number | `sgG001`, `sgG005` |
| Adult discs | `ad` + 2-digit number | `ad01`, `ad24` |
| Categories | `c` + number | `c1`–`c7` |

## Adding a Story

Append one row to `_RAW` in `js/data.js`:
```js
[channelNum, 'c1', 'שם הסיפור', 50],
// [channelNum, categoryId, title, durationMin]
```
Story code is auto-generated as `YT-XXXX` from the channel number.
Category IDs: c1=סיפורי חז"ל ומידות, c2=מעגל השנה, c3=ספרי התורה, c4=נביאים, c5=סיפורי מופת, c6=שולחן שבת ובר מצוה, c7=גמרא.

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
