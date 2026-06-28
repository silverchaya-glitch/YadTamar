# FOLLOWUPS — Bugs & Gaps Found In Passing

Format: `- [Severity] file:area | problem | repro`
Severities: P0 (blocker), P1 (must fix before launch), P2 (should fix), P3 (nit)

---

- [P1] admin.html:doLogin() | Admin login accepts any credentials — no real authentication | Navigate to admin.html, enter any email/password → access granted. Security risk if URL is discovered.

- [P1] index.html:payment | HYP payment gateway is placeholder UI only — no real API call is made | Complete checkout → payment step shows HYP UI but submits without charging. Orders go through for free.

- [P2] index.html + admin.html:CSS | Same CSS variable names map to different hex values on each page (`--teal`, `--gold`, `--pink`, etc.) | Copy a style rule from one page to the other → wrong colors appear silently.

- [P2] index.html:localStorage | Orders saved to localStorage only — lost if user clears browser storage or switches device | Submit an order → clear localStorage → order gone with no recovery path.

- [P2] admin.html:data | Admin data (KPI, orders, leads) is static mock from data.js — changes made in admin UI are in-memory only and reset on reload | Change an order status in admin → reload page → status reverts.

- [P3] admin.html:login | Login input fields have hardcoded placeholder values (`yadtamar613@gmail.com` / `admin123`) visible in the DOM | Inspect element on login form → credentials visible in HTML source.
