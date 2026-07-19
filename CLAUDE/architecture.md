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

## CSS Theme (unified — ADR-007, 2026-07-15)

**index.html and admin.html now share the same CSS variable values.** They still live in two separate places (index.html does NOT load `css/main.css` — it keeps its own inline `<style>` per ADR-002/Golden Rule #3), but the `:root` values below are kept identical between the two:

| Variable | Value |
|---|---|
| `--teal` | `#00B4CC` |
| `--teal-dk` | `#007A8C` |
| `--teal-lt` | `#E0F7FA` |
| `--gold` | `#F5C518` |
| `--pink` | `#E91E8C` |
| `--bg` | `#F4FAFB` |
| `--bg2` | `#EAF7F5` |
| `--radius` | `16px` |

Buttons (`.btn`) are pill-shaped (`border-radius: 999px`) in both files.

Previously (before ADR-007) the two pages used deliberately different palettes — index.html an indigo/purple theme, admin.html an actual-teal theme (see superseded ADR-003 in `CLAUDE/decisions.md`). If you ever see the two `:root` blocks diverge again, check whether that was intentional (new ADR needed) or drift to be fixed.

### Claymorphism layer (index.html only — ADR-008, 2026-07-15)

`index.html`'s `:root` also has a Claymorphism-specific token layer that **`css/main.css` only partially shares**:

| Shared with admin (same values in both files) | index.html only |
|---|---|
| `--fs-display/h1/h2/h3/body/body-sm/label/micro` | `--radius-sm/md/lg` |
| `--space-1` through `--space-9` (base-8) | `--clay-shadow-sm/md/lg`, `--clay-border-tint` |
| `--ease-clay` (applied to `.btn*` in both) | `--content-wide`/`--content-narrow` |

Fredoka (display font) loads only in `index.html`, on a closed list of 9 headline selectors (see ADR-008) — never in admin.html. Clay shadows/thick tinted borders/bounce and the scroll-reveal JS (`initScrollReveal()`) are **index.html-only** — deliberately not applied to admin's `.kpi-card`/`.data-table`/forms/modals, since the installed `ui-ux-pro-max` skill data recommends against Claymorphism for data-critical/corporate UIs. If you add a new shared component, default new sizing/spacing to the shared tokens above, but keep clay depth/Fredoka/reveal scoped to the storefront unless a new ADR says otherwise.

## Persistence

- **DB engine: PostgreSQL** (`server/db/schema.sql`, 11 normalized tables per `CLAUDE/erd.md`: customers, categories, stories, pricing_rules, orders, order_items, payments, fulfillment_requests, email_logs, leads, admin_users). Replaces the earlier flat SQLite schema (`yadtamar.db` is no longer used but kept on disk).
- Customer orders → Postgres via `POST /api/orders` (Express server, `server/db/index.js` using `pg`). `localStorage` key `yadtamar_orders` kept as cache after confirmed server response.
- Gift story leads → Postgres via `POST /api/leads`. `localStorage` key `yadtamar_leads` kept as cache.
- Admin data (KPI, orders, leads) → live from `/api/admin/*` endpoints backed by Postgres.
- Admin login (`POST /api/admin/login`) checks email + bcrypt hash against `admin_users` table (single MVP admin row, seeded from `.env` via `server/db/seed-admin.js`), no longer plaintext `.env` comparison.
- If the server is unreachable, `submitOrder` / `submitGift` show an error toast and do NOT advance — the order is never shown as "confirmed" until the DB write succeeds.
- **Catalog seeding**: `server/db/seed-catalog.js` loads `CATEGORIES`/`STORIES`/`PRICING_RULES` from `js/data.js` (via Node's `vm` module, without modifying the file) and joins each story to a real `google_drive_file_id` from `files/list_from_drive.csv` by story number. 433/438 stories have a real Drive ID this way; the 5 `_GEMARA` stories (G001–G005) have no matching file in that CSV and get a `PENDING-DRIVE-ID-*` placeholder until a source is provided.
- **⚠️ Demo/fake data**: `server/db/seed-fake-data.js` inserts temporary demo customers/orders/leads (identifiable by `order_number LIKE 'DEMO-%'` / email `LIKE 'demo.%'`) for end-to-end testing. **Must be deleted before real customer data goes live** — see `FOLLOWUPS.md`.
- **Store catalog (`index.html`)** now fetches `GET /api/catalog` (public, no auth — `server/routes/catalog.js` → `db.getCatalog()`) on page load instead of reading the static `STORIES`/`CATEGORIES` from `js/data.js`. Returns only active stories/categories, joined, with `durationMinutes` pre-computed; deliberately omits `google_drive_file_id`/`is_active`/timestamps (internal-only fields, no reason to expose to every visitor). `admin.html`'s catalog view still reads the static `js/data.js` arrays — the two can diverge (see `FOLLOWUPS.md`).
