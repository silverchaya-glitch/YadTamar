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
