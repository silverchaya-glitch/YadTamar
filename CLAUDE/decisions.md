# Architecture Decision Records

## ADR-001: Static HTML — No Backend

**Status:** Accepted (MVP)

**Decision:** The entire site is static HTML/CSS/JS. No server, no database, no API.

**Why:** Fastest path to a working MVP. Hosting is trivial (any static server or CDN). No deployment complexity, no server maintenance. For a first product demonstration this was the right tradeoff.

**Consequence:** Orders saved to `localStorage` only — lost when browser storage is cleared. Payment is a stub. This is acceptable for MVP but must be replaced before real sales.

---

## ADR-002: Inline JS per Page

**Status:** Accepted (MVP)

**Decision:** All JavaScript lives inside `<script>` tags within each HTML file. No separate `.js` modules (except `data.js` which is a shared data file, not a module).

**Why:** Zero build tooling. Any editor can open and run the file immediately. Eliminates import/module/bundler complexity for a two-page app.

**Consequence:** index.html and admin.html are large files. If the app grows beyond 2 pages, extract to separate JS files.

---

## ADR-003: Two Separate CSS Themes

**Status:** Accepted (intentional)

**Decision:** index.html uses its own inline `<style>` block with an indigo/purple palette (`--teal: #6366F1`). admin.html uses `css/main.css` with an actual teal palette (`--teal: #00B4CC`).

**Why:** Store and admin are intentionally distinct brand experiences. The store has a warm, consumer-friendly indigo feel. The admin has a professional teal/business feel.

**Consequence:** Same CSS variable names map to different colors on different pages. See `CLAUDE/architecture.md` for the full mapping table. Never edit styles without checking which page you're in.

---

## ADR-004: localStorage for Order Persistence

**Status:** Temporary (MVP)

**Decision:** Submitted orders are written to `localStorage` key `yadtamar_orders`.

**Why:** No backend. Needed some persistence mechanism for the demo.

**Consequence:** Orders are lost if user clears browser storage. Not suitable for production. See BACKLOG for backend replacement.

---

## ADR-005: Any-Credential Admin Login

**Status:** Temporary (MVP)

**Decision:** `doLogin()` in admin.html accepts any email/password combination.

**Why:** Auth was out of scope for the initial MVP. The admin is not publicly linked.

**Consequence:** Security risk if the admin URL is discovered. Must be replaced with real auth before going live. See BACKLOG.

**Update (2026-07-02):** Superseded — see ADR-006. Login now checks bcrypt-hashed credentials in the `admin_users` table via JWT + httpOnly cookie.

---

## ADR-006: PostgreSQL as System of Record (per ERD)

**Status:** Accepted

**Decision:** Replaced the flat 2-table SQLite schema (`orders`, `leads`) with the full 11-entity normalized PostgreSQL schema defined in `CLAUDE/erd.md` (`customers`, `categories`, `stories`, `pricing_rules`, `orders`, `order_items`, `payments`, `fulfillment_requests`, `email_logs`, `leads`, `admin_users`). `server/db/index.js` was rewritten over `pg`; `server/routes/*` were updated to `await` the now-async DB calls and to stop coercing IDs with `Number(...)` (primary keys are UUIDs now, not autoincrement integers).

**Why:** `CLAUDE/erd.md` already specified "PostgreSQL is the system of record" as a design principle; the SQLite implementation was a stopgap. The normalized schema is required before real payment/fulfillment/email integrations (still out of scope) can be built on solid ground.

**Consequence:**
- `server/db/index.js`'s public function contract (`createOrder`, `updateOrder`, `updateLead`, `getOrder`, `getOrders`, `createLead`, `getLeads`, `getKPI`) is unchanged, but every function is now `async` — callers must `await`.
- The JSON shape returned to `admin.html`/`index.html` is unchanged (same field names/values `admin.html`'s badge-rendering functions already expected the real ERD enum values, e.g. `PAID`/`PENDING`/`SELECTED_STORIES` — no frontend changes were needed).
- Real story catalog data (categories/stories/pricing) is loaded from `js/data.js` at seed time via Node's `vm` module — the file itself is never modified, preserving the "`js/data.js` is the only external JS file, add stories only via `_RAW`" golden rule.
- `google_drive_file_id` (required by the ERD, DC-04) is populated from `files/list_from_drive.csv` for 433/438 stories; kept server-side only (not exposed in the public `js/data.js`) since there's no reason to expose internal Drive file IDs to every site visitor.
- Demo/fake data was seeded for testing (`server/db/seed-fake-data.js`) and **must be deleted before production** — see `FOLLOWUPS.md`.
- `yadtamar.db` (SQLite) is left on disk unused; `better-sqlite3` was removed from `package.json`.
- Payment gateway integration, real Google Drive file-sharing automation, and real email sending remain **out of scope** — the new tables (`payments`, `fulfillment_requests`, `email_logs`) exist and can be updated manually by admins, but nothing writes to them automatically yet.
