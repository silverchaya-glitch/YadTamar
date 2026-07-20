# BACKLOG — Deferred Features & Ideas

Format: `- [Priority] feature | why deferred | rough scope`
Priorities: HIGH, MED, LOW

---

## Infrastructure

- [HIGH] Real backend (Node.js / Python) for order persistence | MVP used localStorage; not production-viable | New: server, DB (PostgreSQL or Firebase), API endpoints for orders/leads
- [HIGH] Real admin authentication (JWT or session-based) | Any-credential login is an MVP stub; security risk | New: auth middleware, hashed password, session management
- [DONE 2026-07-20] HYP payment gateway real integration | Payment UI exists but no API call is wired | Integrated: Hosted Page redirect + webhook, see PROGRESS.txt hyp-payment-integration. Still open: real HYP_API_KEY/HYP_TERMINAL_ID/HYP_API_BASE_URL/HYP_WEBHOOK_SECRET not yet received — see FOLLOWUPS.md.

## Order Fulfillment

- [HIGH] Digital delivery system — Google Drive link per order | No automated delivery exists; fulfillment is manual | On payment confirmation, auto-generate a shared Drive link scoped to purchased stories and email it to customer
- [MED] Email confirmation on order submission | No email is sent currently | Integrate email service (SendGrid / Resend); send order receipt to customer

## Admin

- [MED] Persist admin actions (order status changes, notes) | Currently in-memory only | Connect to backend DB; admin mutations write through API
- [MED] Real KPI data from actual orders | Dashboard shows static mock data | Replace mock ORDERS/LEADS/KPI in data.js with live API calls

## Store / UX

- [MED] Mobile-optimized catalog browsing | Catalog works on mobile but not optimized for small screens | Review touch targets, column count, filter panel on mobile
- [LOW] Search within catalog | No text search; only category filter | Add a search input that filters STORIES by title
- [LOW] Wishlist / save for later | No way to save a selection between sessions | Store partial selection in localStorage

## Tech Debt

- [LOW] Unify CSS variable values across index.html and admin.html | Two divergent palettes with same variable names is a maintenance trap | Decide on one brand palette; migrate admin to match or rename variables to avoid collision
- [LOW] Extract inline JS to separate files | index.html and admin.html are very large | Only worth doing if a third page is added or if the files become hard to navigate
