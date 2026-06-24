# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

יד תמר — חנות דיגיטלית למכירת 428 סיפורי שמע לילדים (ועוד 24 דיסקים לאוסף מבוגרים). אתר סטטי לחלוטין — HTML/CSS/JS בלבד, ללא backend, ללא build system, ללא package manager.

## Running the Project

No build step. Open files directly in a browser or serve with any static server:

```bash
python3 -m http.server 8080 --directory /www/YadTamar
# then open http://localhost:8080
```

Main pages:
- `index.html` — Store (customer-facing)
- `admin.html` — Admin panel

Snapshot/wireframe files prefixed with `_` or `_snap_` are reference designs, not active pages.

## Architecture

**Two-page app sharing a single data layer:**

```
js/data.js      ← global constants + mock data (loaded by both pages via <script>)
css/main.css    ← shared stylesheet (RTL Hebrew, Heebo font, CSS variables)
index.html      ← store wizard + all store JS inline
admin.html      ← admin panel + all admin JS inline
```

All JavaScript is inline `<script>` inside each HTML file — there are no separate JS modules.

### Data Layer (`js/data.js`)

Exports globals consumed by both pages:
- `PRICING_RULES` — tiered unit prices (₪8 → ₪7.5 → ₪7 → ₪6 → ₪4.3)
- `STORIES` — 433 items built from `_RAW` (children, ids `s1`–`s433`) + `_GEMARA` (5 Gemara files, ids `sgG001`–`sgG005`)
- `CATEGORIES` — 7 category objects (`c1`–`c7`)
- `ADULT_DISCS` — 24 adult collection discs
- `ORDERS`, `LEADS`, `KPI` — sample/mock data for admin dashboard
- `calcUnitPrice(qty)`, `calcTotal(qty)` — pricing engine

### Store (`index.html`)

4-step purchase wizard managed by a single `state` object:
1. Catalog — filter/select individual stories or choose a bundle
2. Order summary — delivery options (Drive / USB)
3. Customer details + payment method selection
4. Confirmation

On submit, orders are saved to `localStorage` key `yadtamar_orders`. Payment processing (HYP) is a placeholder UI — no real API integration yet.

Products: `STORY_SELECTION`, `FULL_LIBRARY` (₪1,550), `ADULT_COLLECTION` (₪360), gift story (free lead).
USB add-on: ₪15, free when ≥50 files; always bundled with `ADULT_COLLECTION`.

### Admin (`admin.html`)

5 panels: Dashboard, Orders, Fulfillment, Leads, Catalog.
Login is MVP-only — any credentials are accepted (no real auth).
Admin data (KPI, orders, leads) is static mock data in `data.js`; changes made in the admin panel are in-memory only and reset on page reload.

## Key Constants

| Constant | Value |
|---|---|
| `FULL_LIBRARY_PRICE` | 1550 |
| `ADULT_COLLECTION_PRICE` | 360 |
| `USB_PRICE` | 15 |
| `FREE_USB_MIN_FILES` | 50 |
| `TOTAL_STORIES` | 428 |

## Language & Styling

- Interface is Hebrew RTL (`dir="rtl"`, `direction: rtl`)
- Font: Heebo from Google Fonts
- CSS variables defined in `:root` in `main.css` — use `var(--teal)`, `var(--pink)`, `var(--gold)`, etc.
- All user-facing strings are in Hebrew

## Adding Stories

Add a row to `_RAW` in `data.js`:
```js
[429, 'c1', 'שם הסיפור', 50],  // [channelNum, categoryId, title, durationMin]
```
Story code is auto-generated as `YT-XXXX` from the channel number.
