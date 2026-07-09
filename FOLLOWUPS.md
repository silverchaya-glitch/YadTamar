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

- [P2] admin.html vs index.html:catalog source | 2026-07-02: `index.html`'s store catalog (`renderStories()`) now fetches live from `GET /api/catalog` (Postgres `stories`/`categories`), but `admin.html`'s `renderCatalog()` still reads the static `js/data.js` `STORIES`/`CATEGORIES` arrays | The two pages can now show a *different* catalog if one source is updated without the other (e.g., a story added only via `_RAW` won't appear in the store until `seed-catalog.js` re-runs; a story added only via admin's in-memory "add story" button never reaches the DB at all — see item above). Scoped decision, not a bug — but worth fixing by pointing `admin.html` at `/api/catalog` too in a future round.

- [P3] deploy | User requested NGINX + reverse proxy setup for eventual production deployment, targeting a server identified by IP address (no domain yet) | Not started — needs the actual target server's IP/SSH access before it can be planned concretely.

- [P1] server/services/fulfillment.js:ADULT_COLLECTION | fileIds נשלח תמיד כ-[] עבור הזמנות ADULT_COLLECTION — אין שום מיפוי google_drive_file_id ל-24 דיסקי האוסף (לא ב-stories, לא ב-js/data.js ADULT_DISCS) | ה-webhook עדיין יוצא (orderId/recipientEmail/requestType תקינים) אבל בלי קבצים בפועל — הזמנות אוסף מבוגרים לא יכולות להשתלם עד שיסופקו Drive file/folder IDs אמיתיים מבעל האתר.

- [P2] server/routes/orders.js:fulfillment | קריאת ה-webhook יוצאת מיד עם יצירת ההזמנה, לכל אמצעי תשלום — כולל BANK_TRANSFER/CALLBACK שעדיין לא שולמו בפועל. ההבחנה בין "שתף בפועל" (אשראי) ל"צור תיקייה בלבד" (שאר האמצעים) קיימת רק בתוך ה-Apps Script החיצוני (paymentType בגוף הבקשה). אין כרגע מנגנון בצד הפלטפורמה לשלוח קריאה שנייה כש-office מאשר ידנית תשלום בנקאי מאוחר יותר (retryFulfillment הקיים שולח שוב עם אותו paymentType מה-DB, לא "מאשר תשלום") | דורש בעתיד: פעולת אדמין שמעדכנת payment_status ל-PAID *וגם* משדרת איתות לשיתוף בפועל ל-Apps Script, לא רק PATCH גנרי.

- [P2] deploy | שרת ה-Express (server/index.js) לא רץ באופן קבוע — נמצא כבוי ב-2026-07-03 (רק Postgres רץ), מה שגרם לחנות להציג "אין סיפורים" כי index.html טוען קטלוג מ-GET /api/catalog | הופעל ידנית ברקע (nohup node server/index.js) לצורך פיתוח בלבד. בפריסת production צריך תהליך מפוקח (pm2/systemd) שמפעיל את השרת אוטומטית ומרים אותו מחדש אחרי קריסה/ריסטרט.

- [P1] server/services/email.js:integration | 2026-07-06: נבנתה תשתית שליחת מייל גנרית (server/services/email.js + db.logEmail) אבל היא **לא מחוברת עדיין לאף route** — לפי החלטת scope מפורשת, ממתינים למיפוי סופי של נקודות השילוב | נקודות מועמדות שנמצאו במחקר PRD §16 / ERD EmailLog: (1) `server/routes/orders.js` POST / — לקרוא ל-`sendPurchaseConfirmation` מיד אחרי `db.createOrder` (וגם `sendOfficeNotification` על "הזמנה חדשה"); (2) `server/services/fulfillment.js` — לקרוא ל-`sendFileDelivery` בנתיב ההצלחה (ליד `recordFulfillmentSuccess`) ול-`sendErrorNotification` בנתיבי הכישלון (ליד `recordFulfillmentFailure`); (3) `server/routes/leads.js` POST / — לקרוא ל-`sendOfficeNotification` על ליד חדש/בקשת סיפור מתנה. שים לב: `db.createOrder` היום מחזיר רק `id` (לא `orderNumber`/`customerId`) — ייתכן שיידרש להרחיב את הערך המוחזר כדי ש-orders.js יוכל לבנות את תוכן המייל בלי שאילתה נוספת.

- [P2] server/services/email.js:gift-story | "GIFT_STORY" (שליחת "סיפור מתנה" אוטומטית ללקוח, לפי PRD §17) לא ניתן לחיווט כרגע — אין "סיפור קבוע" מוגדר במערכת (leads.html שולח תמיד `gift_story_id: null`, וטבלת `leads` לא שומרת gift_story_id בכלל), ואין דרך היום לבנות קישור הורדה אמיתי לסיפור בודד (שיתוף Drive קיים רק ברמת הזמנה מלאה, דרך fulfillment webhook) | דורש החלטת מוצר: איזה סיפור הוא "סיפור המתנה הקבוע", ואיך משתפים אותו (webhook נפרד? קישור Drive קבוע וגלוי-לכולם?) לפני שאפשר לחבר את `sendGiftStory`.

- [P3] server/services/email.js:failed-payments | "Office Emails: Failed payments" (PRD §16) לא ניתן לחיווט כרגע — אין עדיין אינטגרציית סליקה אמיתית (HYP), ראה FOLLOWUPS P1 למעלה על index.html:payment | ימתין לאינטגרציית תשלום אמיתית.

- [P3] server/services/email.js:retry-logic | "Retry logic shall be implemented for email failures" (PRD §16, שורה אחרונה) לא מומש — `sendRawEmail` מנסה פעם אחת בלבד ומתעד FAILED, בלי queue/backoff | לא נבנה בסבב הזה — scope creep מעבר למנגנון הבסיסי שהתבקש; email_logs עם send_status='FAILED' מאפשר לפחות לזהות ידנית אילו מיילים נכשלו.
