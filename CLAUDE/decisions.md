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

**Status:** Superseded — see ADR-007 (2026-07-15)

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

---

## ADR-007: Unified CSS Theme Across Store and Admin

**Status:** Accepted (2026-07-15)

**Decision:** Supersedes ADR-003. `index.html` (inline `<style>`) and `admin.html`'s `css/main.css` now share the **same** CSS variable values — a single teal/gold/pink palette (`--teal:#00B4CC`, `--gold:#F5C518`, `--pink:#E91E8C`, `--radius:16px`, pill-shaped buttons `border-radius:999px`), instead of the store's former indigo (`--teal:#6366F1`) and the admin's teal.

**Why:** The store now runs on a subdomain of emanuel-tehila.co.il and needs to read as one product with that parent site — not two disconnected "brand experiences" per page. The chosen palette converges toward what the admin panel (and the older `_snap_*`/`_demo_*` reference files) already used, refined for a warmer, more playful feel in the store's hero/cards to match the reference site.

**Consequence:**
- The two files still keep **separate CSS locations** (inline in `index.html`, `css/main.css` for admin) per ADR-002/Golden Rule #3 — only the *values* were unified, not the file structure.
- `css/main.css`'s Heebo `@import` was widened from weights 300–800 to 300–900 to match `index.html`'s `<link>`, so heading weight 900 renders as true bold everywhere instead of falling back to synthetic bold.
- `CLAUDE/architecture.md` and `CLAUDE/conventions.md`'s CSS variable tables must be read as describing the current shared values, not two different sets — update them if either file's `:root` changes again.
- Any new component styling should use the shared token set; do not reintroduce a second, divergent palette without a new ADR.

## ADR-008: Claymorphism Redesign — index.html Only, Scoped Token Sharing to Admin

**Status:** Accepted (2026-07-15)

**Decision:** After ADR-007's color-only unification, the user reported the redesign felt indistinguishable from the original ("אני לא רואה כמעט הבדל בעיצוב לפני ואחרי"). Root cause: `index.html` had only two font weights in use anywhere (400/900), no spacing scale (padding/margin/gap were ad-hoc 4–80px literals), no shape/motion system, and a single reused photo. `index.html` (storefront only — not `admin.html`) was redesigned in the **Claymorphism** style (soft dual inset+outer shadows, thick tinted borders, generous radius, bounce easing), chosen because the installed `ui-ux-pro-max` skill's style data explicitly recommends it for children's/toy-like products and explicitly warns against it for "data-critical/corporate" contexts.

**Why:** Claymorphism directly targets what was missing — real typographic hierarchy (Fredoka display font + `--fs-*` modular scale, headline-only), a `--space-*` base-8 spacing scale, a `--radius-sm/md/lg` hierarchy, tinted `--clay-shadow-sm/md/lg` depth, a shared `--ease-clay` bounce easing, added decorative background shapes, and a one-shot IntersectionObserver scroll-reveal — while staying scoped to the storefront, since the same skill data recommends against clay depth/bounce for data-dense admin dashboards.

**Consequence:**
- `index.html`'s `:root` gained `--fs-display/h1/h2/h3/body/body-sm/label/micro`, `--space-1..9`, `--radius-sm/md/lg` (existing `--radius:16px` untouched, still the default), `--clay-shadow-sm/md/lg`, `--clay-border-tint`, `--ease-clay`, `--content-wide`/`--content-narrow` (collapsed 3 divergent max-widths — 1140/980/960 — to 2 tokens).
- Fredoka (Google Font, Hebrew-safe 400–700) loads alongside Heebo and is used **only** on a closed selector list (`.logo-text h1`, `.hero-text h2`, `.hero-rabbi`, `.section-title`, `.about-main-title`, `.about-intro-name`, `.gift-section h2`, `.success-screen h2`, `.catalog-cat-header h3`) — everywhere else (prices, forms, buttons, `.catalog-table`) stays Heebo per Golden Rule #4/CLAUDE.md.
- `.catalog-table`/`.catalog-table-wrap` deliberately excluded from clay treatment — stays flat/scannable even inside the redesigned store.
- Scroll-reveal (`initScrollReveal()` in `index.html`'s `<script>`) targets only static elements (`.hero-text`, `.hero-illustration`, `.product-card`, `.summary-card`, `.about-card`, `.gift-section`) queried once at `DOMContentLoaded`, never `.story-item`/catalog rows (rebuilt on every search keystroke by `renderStories()`). The hiding CSS is scoped under `.js-reveal-ready [data-reveal]`, a class added only after JS confirms `IntersectionObserver` support — if JS is blocked/fails, `.js-reveal-ready` is never added and all content stays fully visible (verified with DevTools "Disable JavaScript").
- `css/main.css` (admin) received **only** the same-valued `--fs-*`/`--space-*` tokens and `--ease-clay` (applied solely to `.btn*` transitions) — no clay shadows, no thick tinted borders, no Fredoka, no scroll-reveal on `.kpi-card`/`.data-table`/`.modal`/forms, per the skill's own "avoid for data-critical" guidance. `css/main.css`'s `.product-card` rules are confirmed dead CSS (not referenced by any `admin.html` markup) and were left untouched.
- The unused `גלופה 2.jpg` asset was deliberately **not** used this round — it's a closed composition (not a croppable icon/texture) saved as CMYK JPEG (cross-browser color-rendering risk); decorative shapes are pure CSS instead.
