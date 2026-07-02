# FOLLOWUPS — Bugs & Gaps Found In Passing

Format: `- [Severity] file:area | problem | repro`
Severities: P0 (blocker), P1 (must fix before launch), P2 (should fix), P3 (nit)

---

- [~~P1~~FIXED 2026-06-28] admin.html:doLogin() | Admin login accepts any credentials — no real authentication | Fixed: JWT + httpOnly cookie, route guard in Express, separate admin-login.html.

- [P1] index.html:payment | HYP payment gateway is placeholder UI only — no real API call is made | Complete checkout → payment step shows HYP UI but submits without charging. Orders go through for free.

- [~~P2~~FIXED 2026-06-29] index.html + admin.html:CSS | Same CSS variable names map to different hex values on each page (`--teal`, `--gold`, `--pink`, etc.) | Fixed: Added ⚠️ STORE THEME / ADMIN THEME warning comment at top of each :root block. Variable renaming avoided (high visual risk); architecture.md has full diff table.

- [~~P2~~FIXED 2026-06-29] index.html:localStorage | Orders saved to localStorage only — lost if user clears browser storage or switches device | Fixed: submitOrder/submitGift are now async — await API response before advancing to confirmation. On failure shows error toast and stays on step 3. localStorage kept as user-side cache only after confirmed DB write.

- [~~P2~~FIXED 2026-06-29] admin.html:data | Admin data (KPI, orders, leads) is static mock from data.js — changes made in admin UI are in-memory only and reset on reload | Fixed: admin.html now fetches ORDERS/LEADS/KPI from /api/admin/* on load and after every mutation (notes, gift_sent, fulfillment_status persist to SQLite).

- [~~P3~~FIXED 2026-06-28] admin.html:login | Login input fields have hardcoded placeholder values (`yadtamar613@gmail.com` / `admin123`) visible in the DOM | Fixed: login screen moved to admin-login.html with no value attributes.

- [P0] server/db:seed-fake-data.js | 2026-07-02 Postgres migration seeded DEMO customers/orders/leads for E2E testing (identifiable by `order_number LIKE 'DEMO-%'` / email `LIKE 'demo.%'`) | **Must be deleted before real customers use the site.** Delete via SQL (see CLAUDE/decisions.md ADR-006) before production launch.

- [P1] server/db:stories | 5 `_GEMARA` stories (YT-G001–G005) have a `PENDING-DRIVE-ID-*` placeholder in `google_drive_file_id` — `files/list_from_drive.csv` (the real Drive catalog export) doesn't contain matching files for them | Need the real Drive file IDs for these 5 stories from the owner, then re-run/patch `server/db/seed-catalog.js`.

- [P2] js/data.js:TOTAL_STORIES | Constant is hardcoded to 428, but the real catalog (`_RAW` + `_GEMARA`) has 438 entries (433 numbered + 5 gemara) | Found during 2026-07-02 catalog/CSV cross-check. Not fixed — touching this constant wasn't requested and is outside the "add story = one `_RAW` row" golden rule's explicit scope.

- [P2] admin.html:catalog | "➕ הוסף סיפור" (add story) button still only pushes to an in-memory JS array — not persisted, resets on reload. Now that `stories` exists as a real Postgres table (2026-07-02 migration), a `POST /api/admin/stories` route could make this durable | Not built this round — was explicitly out of scope for the DB migration task.

- [P3] deploy | User requested NGINX + reverse proxy setup for eventual production deployment, targeting a server identified by IP address (no domain yet) | Not started — needs the actual target server's IP/SSH access before it can be planned concretely.
