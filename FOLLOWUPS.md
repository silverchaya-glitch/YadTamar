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
