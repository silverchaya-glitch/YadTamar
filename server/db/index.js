const { Pool } = require('pg');

const pool = new Pool(); // מתחבר לפי PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD (או DATABASE_URL) מתוך .env

const { computeOrderPrice, amountsEqual } = require('../services/pricing');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// מוצרים שהחנות מוכרת. "כל הספרייה" נמכרת כ-STORY_SELECTION של כל הסיפורים
// (ר' coversFullLibrary ב-getOrderForFulfillment), לא כמוצר נפרד.
const SELLABLE_PRODUCTS = ['STORY_SELECTION', 'ADULT_COLLECTION', 'GEMARA'];

// שגיאת קלט של לקוח (400) — לא שגיאת שרת.
class OrderValidationError extends Error {}

function mapProductToOrderType(product) {
  if (product === 'MASTER_LIBRARY' || product === 'FULL_LIBRARY') return 'FULL_LIBRARY';
  if (product === 'ADULT_COLLECTION') return 'ADULT_COLLECTION';
  if (product === 'GEMARA') return 'GEMARA';
  return 'STORY_SELECTION';
}

function mapProductToDeliveryType(product) {
  if (product === 'MASTER_LIBRARY' || product === 'FULL_LIBRARY') return 'MASTER_LIBRARY';
  if (product === 'ADULT_COLLECTION') return 'ADULT_COLLECTION';
  if (product === 'GEMARA') return 'GEMARA';
  return 'SELECTED_STORIES';
}

// גוזר סטטוס מאוחד (legacy) מתוך payment_status/processing_status/payment_type —
// נשמר עבור GET /api/orders/:id (מסלול ציבורי ישן, לא בשימוש כרגע ע"י אף עמוד חי)
// SQL: סטטוס ניסיון התשלום האחרון של ההזמנה (o = orders).
const LAST_PAYMENT_STATUS_SQL = `(SELECT p.status FROM payments p WHERE p.order_id = o.id ORDER BY p.created_at DESC LIMIT 1)`;

// כרטיס שנדחה לא סוגר את ההזמנה (נשארת PENDING, אפשר לנסות שוב — החלטת הבעלים
// 2026-10-08), אבל החנות צריכה לדעת שהניסיון האחרון נכשל כדי להציג "נסו שוב".
function deriveLegacyStatus(row) {
  if (row.payment_status === 'FAILED' || row.payment_status === 'CANCELLED') return 'failed';
  if (row.payment_status === 'PENDING' && row.last_payment_status === 'FAILED') return 'failed';
  if (row.processing_status === 'COMPLETED') return 'fulfilled';
  if (row.payment_status === 'PAID') return 'paid';
  if (row.payment_status === 'PENDING' && ['BANK_TRANSFER', 'CALLBACK'].includes(row.payment_type)) return 'pending_manual';
  return 'pending';
}

const STATUS_FILTERS = {
  pending:        "o.payment_status = 'PENDING' AND o.payment_type = 'CREDIT_CARD'",
  pending_manual: "o.payment_status = 'PENDING' AND o.payment_type IN ('BANK_TRANSFER','CALLBACK')",
  paid:           "o.payment_status = 'PAID' AND o.processing_status <> 'COMPLETED'",
  failed:         `(o.payment_status IN ('FAILED','CANCELLED') OR (o.payment_status = 'PENDING' AND ${LAST_PAYMENT_STATUS_SQL} = 'FAILED'))`,
  fulfilled:      "o.processing_status = 'COMPLETED'",
};

function mapOrderRow(row) {
  return {
    id:                row.id,
    orderNumber:       row.order_number,
    customerName:      row.customer_name,
    email:             row.email,
    phone:             row.phone,
    amount:            Number(row.total_amount),
    paymentType:       row.payment_type,
    paymentStatus:     row.payment_status,
    lastPaymentStatus: row.last_payment_status || null,
    processingStatus:  row.processing_status,
    deliveryType:      row.delivery_type,
    fulfillmentStatus: row.fulfillment_status || null,
    usb:               row.usb_amount !== null,
    folderUrl:         row.folder_url || '',
    filesCount:        Number(row.files_count) || 0,
    notes:             row.office_notes || '',
    createdAt:         row.created_at ? new Date(row.created_at).toLocaleString('he-IL') : '',
    createdAtISO:      row.created_at ? new Date(row.created_at).toISOString() : '',
  };
}

module.exports = {
  OrderValidationError,

  // מוסיף הערה ל-office_notes (פעם אחת — לא משכפל אם כבר קיימת).
  async appendOfficeNote(orderId, note) {
    await pool.query(
      `UPDATE orders SET office_notes = CASE WHEN office_notes IS NULL OR office_notes = '' THEN $2
                                             ELSE office_notes || ' | ' || $2 END
        WHERE id = $1 AND position($2 in COALESCE(office_notes, '')) = 0`,
      [orderId, note]
    );
  },

  async createOrder(data) {
    const { customer_name, phone, email, delivery_type, items = {}, total } = data;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      let customerId;
      const existing = await client.query('SELECT id FROM customers WHERE email = $1 LIMIT 1', [email]);
      if (existing.rows.length) {
        customerId = existing.rows[0].id;
        await client.query('UPDATE customers SET full_name = $1, phone = $2 WHERE id = $3', [customer_name, phone, customerId]);
      } else {
        const { rows } = await client.query(
          'INSERT INTO customers (full_name, email, phone) VALUES ($1,$2,$3) RETURNING id',
          [customer_name, email, phone]
        );
        customerId = rows[0].id;
      }

      const product = items.product || 'STORY_SELECTION';
      if (!SELLABLE_PRODUCTS.includes(product)) throw new OrderValidationError('מוצר לא תקין');
      const stories = product === 'STORY_SELECTION' && Array.isArray(items.stories) ? [...new Set(items.stories)] : [];
      const orderType = mapProductToOrderType(product);
      const deliveryTypeErd = mapProductToDeliveryType(product);
      const paymentType = items.paymentType || 'CREDIT_CARD';

      // המחיר מחושב כאן מהקטלוג החי ומ-js/data.js — לא מה-total של הדפדפן.
      // רק סיפורים שהחנות מציגה (פעילים, קטגוריה פעילה, לא גמרא — כמו getCatalog).
      let storyRows = [];
      if (product === 'STORY_SELECTION') {
        if (!stories.length || stories.some(id => typeof id !== 'string' || !UUID_RE.test(id)))
          throw new OrderValidationError('בחירת סיפורים לא תקינה');
        ({ rows: storyRows } = await client.query(
          `SELECT s.id, s.story_code, s.title, c.name AS category_name
             FROM stories s JOIN categories c ON c.id = s.category_id
            WHERE s.id = ANY($1::uuid[]) AND s.is_active AND c.is_active AND c.name NOT LIKE 'גמרא%'`,
          [stories]
        ));
        if (storyRows.length !== stories.length) throw new OrderValidationError('חלק מהסיפורים שנבחרו אינם זמינים — נא לרענן את הדף');
      }
      const price = computeOrderPrice({
        product,
        stories: storyRows.map(r => ({ id: r.id, categoryName: r.category_name })),
        useUsb: delivery_type === 'USB',
      });
      if (!(price.total > 0)) throw new OrderValidationError('סכום הזמנה לא תקין');
      if (!amountsEqual(price.total, total)) {
        console.warn(`[orders] price mismatch: client sent ${total}, server computed ${price.total} (product ${product}, ${storyRows.length} stories, ${email})`);
        throw new OrderValidationError('המחיר אינו תואם — נא לרענן את הדף ולנסות שוב');
      }
      const usbAmount = price.usbAmount;
      const subtotalAmount = price.subtotal;

      const noteParts = [];
      if (items.dedication) noteParts.push('הקדשה: ' + items.dedication);
      if (items.address) {
        const a = items.address;
        const addrStr = [a.street, a.house, a.apt, a.city, a.zip].filter(Boolean).join(' ');
        if (addrStr) noteParts.push('כתובת למשלוח USB: ' + addrStr);
      }
      if (items.feedback) noteParts.push('משוב: ' + items.feedback);
      if (items.contactMePhone) noteParts.push('☎️ ביקש/ה יצירת קשר טלפוני');
      const officeNotes = noteParts.length ? noteParts.join(' | ') : null;

      const { rows: seqRows } = await client.query("SELECT nextval('order_number_seq') AS n");
      const orderNumber = 'YT-' + String(seqRows[0].n).padStart(4, '0');

      const { rows: orderRows } = await client.query(
        `INSERT INTO orders (order_number, customer_id, order_type, delivery_type, payment_type, payment_status, processing_status, subtotal_amount, usb_amount, total_amount, office_notes)
         VALUES ($1,$2,$3,$4,$5,'PENDING','WAITING_PAYMENT',$6,$7,$8,$9) RETURNING id`,
        [orderNumber, customerId, orderType, deliveryTypeErd, paymentType, subtotalAmount, usbAmount, price.total, officeNotes]
      );
      const orderId = orderRows[0].id;

      for (const s of storyRows) {
        await client.query(
          `INSERT INTO order_items (order_id, story_id, story_code_snapshot, story_title_snapshot, unit_price)
           VALUES ($1,$2,$3,$4,$5)`,
          [orderId, s.id, s.story_code, s.title, price.itemPrices.get(s.id) || 0]
        );
      }

      await client.query('COMMIT');
      return { id: orderId, orderNumber, customerId, customerName: customer_name, email, phone, total: price.total };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  },

  async updateOrder(id, fields) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      if (fields.notes !== undefined) {
        await client.query('UPDATE orders SET office_notes = $1 WHERE id = $2', [fields.notes, id]);
      }
      if (fields.drive_folder_url !== undefined) {
        await client.query('UPDATE orders SET folder_url = $1 WHERE id = $2', [fields.drive_folder_url, id]);
      }
      if (fields.status !== undefined) {
        const map = {
          pending:        { payment_status: 'PENDING', processing_status: 'WAITING_PAYMENT' },
          pending_manual: { payment_status: 'PENDING', processing_status: 'WAITING_PAYMENT' },
          paid:           { payment_status: 'PAID',    processing_status: 'READY_FOR_FULFILLMENT' },
          failed:         { payment_status: 'FAILED',  processing_status: 'FAILED' },
          fulfilled:      { payment_status: 'PAID',    processing_status: 'COMPLETED' },
        };
        const s = map[fields.status] || map.pending;
        await client.query('UPDATE orders SET payment_status = $1, processing_status = $2 WHERE id = $3', [s.payment_status, s.processing_status, id]);
      }
      if (fields.fulfillment_status !== undefined) {
        await client.query(
          `INSERT INTO fulfillment_requests (order_id, request_status, sharing_status)
           VALUES ($1, $2, 'PENDING')
           ON CONFLICT (order_id) DO UPDATE SET request_status = EXCLUDED.request_status, updated_at = now()`,
          [id, fields.fulfillment_status]
        );
      }

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  },

  async getOrderForFulfillment(id) {
    const { rows } = await pool.query(
      `SELECT o.id, o.order_number, o.order_type, o.payment_type, o.payment_status, c.email
       FROM orders o JOIN customers c ON c.id = o.customer_id
       WHERE o.id = $1`,
      [id]
    );
    if (!rows.length) return null;
    const order = rows[0];

    let fileIds = [];
    if (order.order_type === 'STORY_SELECTION') {
      const { rows: fileRows } = await pool.query(
        `SELECT s.google_drive_file_id FROM order_items oi
         JOIN stories s ON s.id = oi.story_id
         WHERE oi.order_id = $1 AND s.google_drive_file_id NOT LIKE 'PENDING%'`,
        [id]
      );
      fileIds = fileRows.map(r => r.google_drive_file_id);
    }
    // FULL_LIBRARY -> fileIds נשאר [] (PRD §13: משתפים Master folder קבוע, לא מכפילים 428 קבצים)
    // ADULT_COLLECTION -> fileIds נשאר [] (אין מיפוי Drive לדיסקים — ראה FOLLOWUPS.md)

    // בחירה של כל סיפורי הילדים מסופקת מתיקיית ה-Master — החנות שולחת "בחר הכל" כ-
    // STORY_SELECTION, ו-433 מזהים ב-URL של ה-webhook נדחים ע"י Google (HTTP 400).
    // רק בחירה מלאה (החלטת הבעלים) — לא לפי מחיר, אחרת 310 סיפורים ב-₪1550 קיבלו
    // את כל 433. התיקייה מכילה את כל סיפורי הילדים (c1–c17), לא את הגמרא.
    let coversFullLibrary = false;
    let gemaraItemsCount = 0;
    if (order.order_type === 'STORY_SELECTION') {
      const { rows: [cov] } = await pool.query(
        `SELECT
           (SELECT count(DISTINCT oi.story_id) FROM order_items oi
              JOIN stories s ON s.id = oi.story_id JOIN categories c ON c.id = s.category_id
             WHERE oi.order_id = $1 AND s.is_active AND c.is_active AND c.name NOT LIKE 'גמרא%')::int AS selected_children,
           (SELECT count(*) FROM stories s JOIN categories c ON c.id = s.category_id
             WHERE s.is_active AND c.is_active AND c.name NOT LIKE 'גמרא%')::int AS total_children,
           (SELECT count(*) FROM order_items oi
              JOIN stories s ON s.id = oi.story_id JOIN categories c ON c.id = s.category_id
             WHERE oi.order_id = $1 AND c.name LIKE 'גמרא%')::int AS gemara_items`,
        [id]
      );
      gemaraItemsCount = cov.gemara_items;
      coversFullLibrary = cov.total_children > 0 && cov.selected_children >= cov.total_children;
    }

    return {
      orderNumber: order.order_number,
      orderType: order.order_type,
      paymentType: order.payment_type,
      paymentStatus: order.payment_status,
      recipientEmail: order.email,
      fileIds,
      coversFullLibrary,
      gemaraItemsCount,
    };
  },

  async recordFulfillmentAttempt(orderId, requestSentAt) {
    await pool.query(
      `INSERT INTO fulfillment_requests (order_id, request_status, sharing_status, attempts_count, request_sent_at)
       VALUES ($1, 'SENT', 'PENDING', 1, $2)
       ON CONFLICT (order_id) DO UPDATE SET
         request_status = 'SENT',
         attempts_count = fulfillment_requests.attempts_count + 1,
         request_sent_at = EXCLUDED.request_sent_at,
         updated_at = now()`,
      [orderId, requestSentAt]
    );
  },

  // נקראת מ-confirmManualPayment (server/services/fulfillment.js) כדי לדעת אם הזמנה
  // בהעברה בנקאית/טלפון כבר מחכה בשלב WAITING_MANUAL עם תיקייה קיימת, לפני שמחליטים
  // אם לקרוא לשלב 2 (שיתוף) מחדש או להריץ את כל הצינור מהתחלה.
  async getFulfillmentRequest(orderId) {
    const { rows } = await pool.query(
      `SELECT request_status, sharing_status, external_folder_id, external_folder_url, shared_email
       FROM fulfillment_requests WHERE order_id = $1`,
      [orderId]
    );
    if (!rows.length) return null;
    const row = rows[0];
    return {
      requestStatus: row.request_status,
      sharingStatus: row.sharing_status,
      externalFolderId: row.external_folder_id,
      externalFolderUrl: row.external_folder_url,
      sharedEmail: row.shared_email,
    };
  },

  // עדכון 2026-07-13: השדות מקורם כעת בשתי קריאות webhook נפרדות שמאוחדות
  // ע"י server/services/fulfillment.js לפני הקריאה הזו — external_folder_id/url
  // ו-item_results משלב 1 (יצירת התיקייה, הסקריפט הקיים), sharing_status/shared_email
  // משלב 2 (shareLib, apps-script/share-lib.gs) — לא קריאה אחת כמו קודם.
  // sharing_status יכול להיות 'SHARED' (shareLib שיתף בפועל) או 'WAITING_MANUAL' (העברה
  // בנקאית/מזומן — שלב 1 קבע שממתינים לאישור תשלום ידני, שלב 2 לא נקרא כלל).
  // shared_at מתעדכן רק כש-sharing_status === 'SHARED'.
  async recordFulfillmentSuccess(orderId, {
    requestStatus, sharingStatus, externalFolderId, externalFolderUrl, sharedEmail, itemResults, responseReceivedAt,
  }) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const sharedAt = sharingStatus === 'SHARED' ? responseReceivedAt : null;
      await client.query(
        `UPDATE fulfillment_requests SET
           request_status = $2, sharing_status = $3,
           external_folder_id = $4, external_folder_url = $5, shared_email = $6, shared_at = $7,
           item_results = $8, error_code = NULL, error_message = NULL,
           response_received_at = $9, updated_at = now()
         WHERE order_id = $1`,
        [orderId, requestStatus, sharingStatus, externalFolderId, externalFolderUrl, sharedEmail, sharedAt,
         itemResults ? JSON.stringify(itemResults) : null, responseReceivedAt]
      );
      await client.query('UPDATE orders SET folder_url = $2 WHERE id = $1', [orderId, externalFolderUrl]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  },

  // UPSERT (לא UPDATE רגיל) — חייב לעבוד גם אם נקרא לפני recordFulfillmentAttempt
  // (למשל FULFILLMENT_WEBHOOK_URL/SECRET חסרים — אין עדיין שורה להזמנה הזו)
  async recordFulfillmentFailure(orderId, { errorCode, errorMessage, externalFolderId = null, externalFolderUrl = null, itemResults = null, responseReceivedAt }) {
    await pool.query(
      `INSERT INTO fulfillment_requests (order_id, request_status, sharing_status, error_code, error_message, external_folder_id, external_folder_url, item_results, response_received_at)
       VALUES ($1, 'FAILED', 'FAILED', $2, $3, $4, $5, $6, $7)
       ON CONFLICT (order_id) DO UPDATE SET
         request_status = 'FAILED', sharing_status = 'FAILED', error_code = $2, error_message = $3,
         external_folder_id = $4, external_folder_url = $5, item_results = $6, response_received_at = $7, updated_at = now()`,
      [orderId, errorCode, errorMessage, externalFolderId, externalFolderUrl, itemResults ? JSON.stringify(itemResults) : null, responseReceivedAt]
    );
  },

  async getOrderForPayment(orderId) {
    const { rows } = await pool.query(
      `SELECT o.id, o.order_number, o.payment_type, o.payment_status, o.total_amount, o.delivery_type,
              o.customer_id, o.office_notes, c.full_name AS customer_name, c.email, c.phone
       FROM orders o JOIN customers c ON c.id = o.customer_id
       WHERE o.id = $1`,
      [orderId]
    );
    if (!rows.length) return null;
    const row = rows[0];
    return {
      id: row.id,
      orderNumber: row.order_number,
      paymentType: row.payment_type,
      paymentStatus: row.payment_status,
      totalAmount: Number(row.total_amount),
      deliveryType: row.delivery_type,
      customerId: row.customer_id,
      customerName: row.customer_name,
      email: row.email,
      phone: row.phone,
      notes: row.office_notes || '',
    };
  },

  async createPendingPayment({ orderId, amount }) {
    const { rows } = await pool.query(
      `INSERT INTO payments (order_id, provider, amount, status) VALUES ($1,'HYP',$2,'PENDING') RETURNING id`,
      [orderId, amount]
    );
    return rows[0].id;
  },

  // אטומית: מעדכנת payments + orders יחד, תחת נעילת שורת ההזמנה (חזרות במקביל
  // מסודרות בתור). idempotent — הזמנה שכבר PAID, או מספר עסקה שכבר נרשם, מחזירים
  // duplicate:true בלי לגעת בכלום. כרטיס שנדחה מסמן רק את ניסיון התשלום FAILED —
  // ההזמנה נשארת PENDING כדי שהלקוח יוכל לנסות שוב (החלטת הבעלים 2026-10-08).
  // אישור שמגיע בלי ניסיון PENDING פתוח (למשל אחרי שסירוב סגר אותו והלקוח ניסה שוב
  // בעמוד HYP) נרשם כניסיון חדש — לא נבלע כ"כפול" כשהלקוח חויב בפועל.
  async recordPaymentResult({ orderId, providerTransactionId, status, rawResponse, amount }) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: orderRows } = await client.query(
        'SELECT payment_status, total_amount FROM orders WHERE id = $1 FOR UPDATE', [orderId]
      );
      if (!orderRows.length || orderRows[0].payment_status !== 'PENDING') {
        await client.query('COMMIT');
        return { duplicate: true, orderId, status };
      }
      if (providerTransactionId) {
        const { rows: seen } = await client.query(
          'SELECT 1 FROM payments WHERE provider_transaction_id = $1', [providerTransactionId]
        );
        if (seen.length) {
          await client.query('COMMIT');
          return { duplicate: true, orderId, status };
        }
      }

      const { rows: pendingRows } = await client.query(
        `SELECT id FROM payments WHERE order_id = $1 AND status = 'PENDING'
         ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
        [orderId]
      );
      const raw = rawResponse ? JSON.stringify(rawResponse) : null;
      if (pendingRows.length) {
        await client.query(
          `UPDATE payments SET status = $1, provider_transaction_id = $2, raw_response_json = $3 WHERE id = $4`,
          [status, providerTransactionId || null, raw, pendingRows[0].id]
        );
      } else if (status === 'APPROVED' || providerTransactionId) {
        await client.query(
          `INSERT INTO payments (order_id, provider, amount, status, provider_transaction_id, raw_response_json)
           VALUES ($1,'HYP',$2,$3,$4,$5)`,
          [orderId, amount ?? orderRows[0].total_amount, status, providerTransactionId || null, raw]
        );
      } else {
        // סירוב בלי ניסיון פתוח ובלי מספר עסקה — כנראה רענון של אותה חזרה.
        await client.query('COMMIT');
        return { duplicate: true, orderId, status };
      }

      if (status === 'APPROVED') {
        await client.query(
          `UPDATE orders SET payment_status = 'PAID',
             processing_status = CASE WHEN processing_status IN ('COMPLETED','PROCESSING') THEN processing_status ELSE 'READY_FOR_FULFILLMENT' END
           WHERE id = $1`,
          [orderId]
        );
      }

      await client.query('COMMIT');
      return { duplicate: false, orderId, status };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  },

  // מספר עסקה של HYP שכבר נרשם (לכל הזמנה) — חזרה מזויפת שממחזרת Id אמיתי.
  async isProviderTransactionUsed(providerTransactionId) {
    const { rows } = await pool.query('SELECT 1 FROM payments WHERE provider_transaction_id = $1', [providerTransactionId]);
    return rows.length > 0;
  },

  // עסקאות אשראי שאושרו בטווח זמנים — לסיכום היומי למשרד (השוואה מול פורטל HYP).
  async getApprovedCardPayments(from, to) {
    const { rows } = await pool.query(
      `SELECT o.order_number, c.full_name AS customer_name, p.amount, p.provider_transaction_id,
              p.raw_response_json->>'ACode' AS acode, p.created_at
         FROM payments p JOIN orders o ON o.id = p.order_id JOIN customers c ON c.id = o.customer_id
        WHERE p.status = 'APPROVED' AND p.created_at >= $1 AND p.created_at < $2
          AND p.provider_transaction_id NOT LIKE 'MOCK-%'
        ORDER BY p.created_at`,
      [from, to]
    );
    return rows;
  },

  async hasEmailLog(emailType, sinceDate) {
    const { rows } = await pool.query(
      "SELECT 1 FROM email_logs WHERE email_type = $1 AND send_status = 'SENT' AND created_at >= $2 LIMIT 1", [emailType, sinceDate]
    );
    return rows.length > 0;
  },

  async logEmail({ orderId = null, customerId = null, emailType, recipientEmail, sendStatus, sentAt = null }) {
    await pool.query(
      `INSERT INTO email_logs (order_id, customer_id, email_type, recipient_email, send_status, sent_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [orderId, customerId, emailType, recipientEmail, sendStatus, sentAt]
    );
  },

  async updateLead(id, fields) {
    if (fields.gift_sent !== undefined) {
      await pool.query('UPDATE leads SET gift_sent = $1 WHERE id = $2', [Boolean(fields.gift_sent), id]);
    }
  },

  async getOrder(id) {
    const { rows } = await pool.query(
      `SELECT o.*, ${LAST_PAYMENT_STATUS_SQL} AS last_payment_status, c.full_name AS customer_name, c.email, c.phone
       FROM orders o JOIN customers c ON c.id = o.customer_id
       WHERE o.id = $1`,
      [id]
    );
    if (!rows.length) return null;
    const row = rows[0];
    return {
      id: row.id,
      status: deriveLegacyStatus(row),
      drive_folder_url: row.folder_url || null,
      order_type: row.order_type,
    };
  },

  async getOrders(status) {
    const whereSql = status && STATUS_FILTERS[status] ? `WHERE ${STATUS_FILTERS[status]}` : '';
    const { rows } = await pool.query(`
      SELECT
        o.id, o.order_number, o.payment_type, o.payment_status, o.processing_status,
        o.delivery_type, o.usb_amount, o.total_amount, o.folder_url, o.office_notes, o.created_at,
        ${LAST_PAYMENT_STATUS_SQL} AS last_payment_status,
        c.full_name AS customer_name, c.email, c.phone,
        fr.request_status AS fulfillment_status,
        COALESCE(oi.files_count, 0) AS files_count
      FROM orders o
      JOIN customers c ON c.id = o.customer_id
      LEFT JOIN fulfillment_requests fr ON fr.order_id = o.id
      LEFT JOIN (
        SELECT order_id, COUNT(*) AS files_count FROM order_items GROUP BY order_id
      ) oi ON oi.order_id = o.id
      ${whereSql}
      ORDER BY o.created_at DESC
    `);
    return rows.map(mapOrderRow);
  },

  async createLead(data) {
    const { name, email, phone, gift_story_id } = data;
    const source = gift_story_id ? 'GIFT_STORY' : 'CALLBACK';
    const { rows } = await pool.query(
      `INSERT INTO leads (full_name, email, phone, source, gift_sent) VALUES ($1,$2,$3,$4,false) RETURNING id`,
      [name, email, phone, source]
    );
    return rows[0].id;
  },

  async getLeads() {
    const { rows } = await pool.query('SELECT * FROM leads ORDER BY created_at DESC');
    return rows.map(row => ({
      id:        row.id,
      name:      row.full_name,
      email:     row.email,
      phone:     row.phone || '',
      source:    row.source,
      giftSent:  Boolean(row.gift_sent),
      createdAt: row.created_at ? new Date(row.created_at).toLocaleString('he-IL') : '',
    }));
  },

  async getStoryByCode(storyCode) {
    const { rows } = await pool.query(
      'SELECT id, story_code, title, google_drive_file_id FROM stories WHERE story_code = $1 AND is_active = true',
      [storyCode]
    );
    if (!rows.length) return null;
    return { id: rows[0].id, storyCode: rows[0].story_code, title: rows[0].title, googleDriveFileId: rows[0].google_drive_file_id };
  },

  async getCatalog() {
    // קטגוריית גמרא נמכרת כבאנדל עצמאי קבוע (₪90, לא לפי סיפור) — לא חלק מהקטלוג
    // הרגיל הנצפה/נבחר לפי-סיפור, ולכן מוחרגת כאן (לא ב-admin.html, שקורא מ-data.js
    // ישירות ורוצה לראות הכל).
    const [{ rows: categories }, { rows: stories }] = await Promise.all([
      pool.query(`SELECT id, name, display_order FROM categories WHERE is_active = true AND name NOT LIKE 'גמרא%' ORDER BY display_order`),
      pool.query(`
        SELECT s.id, s.story_code, s.category_id, s.title, s.gate, s.duration_seconds
        FROM stories s
        JOIN categories c ON c.id = s.category_id
        WHERE s.is_active = true AND c.is_active = true AND c.name NOT LIKE 'גמרא%'
        ORDER BY c.display_order, length(s.story_code), s.story_code
      `),
    ]);
    return {
      categories: categories.map(c => ({ id: c.id, name: c.name, displayOrder: c.display_order })),
      stories: stories.map(s => ({
        id:              s.id,
        storyCode:       s.story_code,
        categoryId:      s.category_id,
        title:           s.title,
        gate:            s.gate,
        durationMinutes: s.duration_seconds ? Math.round(s.duration_seconds / 60) : null,
      })),
    };
  },

  async getKPI() {
    const today = new Date().toISOString().slice(0, 10);
    const firstOfMonth = today.slice(0, 7) + '-01';
    const [ordersToday, requiresAttention, failedPayments, leadsOnly, paidCreditOrders, monthlyRevenue, usbOrders, systemErrors] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS n FROM orders WHERE created_at::date = $1', [today]),
      pool.query("SELECT COUNT(*)::int AS n FROM orders WHERE payment_status = 'PENDING' AND payment_type IN ('BANK_TRANSFER','CALLBACK')"),
      pool.query(`SELECT COUNT(*)::int AS n FROM orders o WHERE ${STATUS_FILTERS.failed}`),
      pool.query('SELECT COUNT(*)::int AS n FROM leads'),
      pool.query("SELECT COUNT(*)::int AS n FROM orders WHERE payment_status = 'PAID'"),
      pool.query("SELECT COALESCE(SUM(total_amount),0)::float AS n FROM orders WHERE payment_status = 'PAID' AND created_at >= $1", [firstOfMonth]),
      pool.query('SELECT COUNT(*)::int AS n FROM orders WHERE usb_amount IS NOT NULL'),
      pool.query(`
        SELECT
          (SELECT COUNT(*)::int FROM fulfillment_requests WHERE request_status = 'FAILED') +
          (SELECT COUNT(*)::int FROM email_logs WHERE send_status = 'FAILED') AS n
      `),
    ]);
    return {
      ordersToday:       ordersToday.rows[0].n,
      requiresAttention: requiresAttention.rows[0].n,
      failedPayments:    failedPayments.rows[0].n,
      leadsOnly:         leadsOnly.rows[0].n,
      paidCreditOrders:  paidCreditOrders.rows[0].n,
      monthlyRevenue:    monthlyRevenue.rows[0].n,
      usbOrders:         usbOrders.rows[0].n,
      systemErrors:      systemErrors.rows[0].n,
    };
  },
};
