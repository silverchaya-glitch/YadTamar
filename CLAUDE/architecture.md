# Architecture

## Overview

Two-page static app with a shared data layer. No backend, no build system, no package manager.

```
js/data.js          ← shared globals (loaded by both pages via <script src="...">)
css/main.css        ← admin stylesheet only (RTL, Heebo, CSS vars)
index.html          ← store wizard + ALL store JS inline in <script>
admin.html          ← admin panel + ALL admin JS inline in <script>
```

## Data Layer (`js/data.js`)

Global constants and functions consumed by both pages:

| Export | Type | Description |
|---|---|---|
| `PRICING_RULES` | array | 5 pricing tiers: ₪8 / ₪7.5 / ₪7 / ₪6 / ₪4.3 |
| `ADULT_DISCS` | array | 24 adult collection discs with `{id, cat, catName, disc, count}` |
| `FULL_LIBRARY_PRICE` | const | 1550 |
| `ADULT_COLLECTION_PRICE` | const | 360 |
| `USB_PRICE` | const | 15 |
| `FREE_USB_MIN_FILES` | const | 50 |
| `TOTAL_STORIES` | const | 428 |
| `calcUnitPrice(qty)` | fn | Returns unit price for qty |
| `calcTotal(qty)` | fn | Returns total, capped at FULL_LIBRARY_PRICE |
| `CATEGORIES` | array | 7 categories: c1–c7 |
| `STORIES` | array | Built from `_RAW` (children s1–s433) + `_GEMARA` (sgG001–sgG005) |
| `ORDERS`, `LEADS`, `KPI` | arrays | Mock/sample data for admin dashboard |

## Store (`index.html`)

4-step purchase wizard managed by a single `state` object:

1. **Catalog** — filter/select individual stories or choose a bundle
2. **Order Summary** — delivery options (Drive / USB)
3. **Customer Details** — name, phone, email + payment method selection
4. **Confirmation** — order saved to `localStorage` key `yadtamar_orders`

Products available:
- `STORY_SELECTION` — individual stories from catalog
- `FULL_LIBRARY` (₪1,550) — all 428 stories
- `ADULT_COLLECTION` (₪360) — 24 adult discs
- Gift story (free lead capture)

USB add-on: ₪15; free when ≥50 files; always bundled with `ADULT_COLLECTION`.

Payment: HYP gateway — **placeholder UI only, no real API integration**.

## Admin (`admin.html`)

5 panels, toggled by `showPanel(name)`:
- **Dashboard** — KPI cards + charts
- **Orders** — order list from mock data
- **Fulfillment** — order processing workflow
- **Leads** — gift story leads
- **Catalog** — story browsing

Login: MVP stub — `doLogin()` accepts any credentials.
Admin data is static mock from `data.js`; in-memory only, resets on reload.

## CRITICAL: Two CSS Themes

**index.html and admin.html use different CSS variable values for the same names.**

| Variable | index.html (inline `<style>`) | admin.html via `css/main.css` |
|---|---|---|
| `--teal` | `#6366F1` (indigo/purple) | `#00B4CC` (actual teal) |
| `--teal-dk` | `#4338CA` | `#007A8C` |
| `--teal-lt` | `#EEF2FF` | `#E0F7FA` |
| `--gold` | `#F59E0B` | `#F5C518` |
| `--pink` | `#EC4899` | `#E91E8C` |
| `--bg` | `#F5F7FF` | `#F4FAFB` |

When editing styles: check WHICH page you are editing. Never assume the same hex values.
index.html does NOT load `css/main.css`.

## Persistence

- Customer orders → SQLite (`yadtamar.db`) via `POST /api/orders` (Express server). `localStorage` key `yadtamar_orders` kept as cache after confirmed server response.
- Gift story leads → SQLite via `POST /api/leads`. `localStorage` key `yadtamar_leads` kept as cache.
- Admin data (KPI, orders, leads) → live from `/api/admin/*` endpoints backed by SQLite.
- If the server is unreachable, `submitOrder` / `submitGift` show an error toast and do NOT advance — the order is never shown as "confirmed" until the DB write succeeds.
