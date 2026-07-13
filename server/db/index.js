const { Pool } = require('pg');

const pool = new Pool(); // מתחבר לפי PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD (או DATABASE_URL) מתוך .env

const USB_PRICE = 15;
const FREE_USB_MIN_FILES = 50;

function mapProductToOrderType(product) {
  if (product === 'MASTER_LIBRARY' || product === 'FULL_LIBRARY') return 'FULL_LIBRARY';
  if (product === 'ADULT_COLLECTION') return 'ADULT_COLLECTION';
  return 'STORY_SELECTION';
}

function mapProductToDeliveryType(product) {
  if (product === 'MASTER_LIBRARY' || product === 'FULL_LIBRARY') return 'MASTER_LIBRARY';
  if (product === 'ADULT_COLLECTION') return 'ADULT_COLLECTION';
  return 'SELECTED_STORIES';
}

// גוזר סטטוס מאוחד (legacy) מתוך payment_status/processing_status/payment_type —
// נשמר עבור GET /api/orders/:id (מסלול ציבורי ישן, לא בשימוש כרגע ע"י אף עמוד חי)
function deriveLegacyStatus(row) {
  if (row.payment_status === 'FAILED' || row.payment_status === 'CANCELLED') return 'failed';
  if (row.processing_status === 'COMPLETED') return 'fulfilled';
  if (row.payment_status === 'PAID') return 'paid';
  if (row.payment_status === 'PENDING' && ['BANK_TRANSFER', 'CALLBACK'].includes(row.payment_type)) return 'pending_manual';
  return 'pending';
}

const STATUS_FILTERS = {
  pending:        "o.payment_status = 'PENDING' AND o.payment_type = 'CREDIT_CARD'",
  pending_manual: "o.payment_status = 'PENDING' AND o.payment_type IN ('BANK_TRANSFER','CALLBACK')",
  paid:           "o.payment_status = 'PAID' AND o.processing_status <> 'COMPLETED'",
  failed:         "o.payment_status IN ('FAILED','CANCELLED')",
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
    processingStatus:  row.processing_status,
    deliveryType:      row.delivery_type,
    fulfillmentStatus: row.fulfillment_status || null,
    usb:               row.usb_amount !== null,
    folderUrl:         row.folder_url || '',
    filesCount:        Number(row.files_count) || 0,
    notes:             row.office_notes || '',
    createdAt:         row.created_at ? new Date(row.created_at).toLocaleString('he-IL') : '',
  };
}

module.exports = {
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
      const stories = Array.isArray(items.stories) ? items.stories : [];
      const orderType = mapProductToOrderType(product);
      const deliveryTypeErd = mapProductToDeliveryType(product);
      const paymentType = items.paymentType || 'CREDIT_CARD';

      const usbRequested = delivery_type === 'USB';
      const usbAmount = usbRequested
        ? ((product === 'ADULT_COLLECTION' || stories.length >= FREE_USB_MIN_FILES) ? 0 : USB_PRICE)
        : null;
      const subtotalAmount = total - (usbAmount || 0);

      const noteParts = [];
      if (items.dedication) noteParts.push('הקדשה: ' + items.dedication);
      if (items.address) {
        const a = items.address;
        const addrStr = [a.street, a.house, a.apt, a.city, a.zip].filter(Boolean).join(' ');
        if (addrStr) noteParts.push('כתובת למשלוח USB: ' + addrStr);
      }
      const officeNotes = noteParts.length ? noteParts.join(' | ') : null;

      const { rows: seqRows } = await client.query("SELECT nextval('order_number_seq') AS n");
      const orderNumber = 'YT-' + String(seqRows[0].n).padStart(4, '0');

      const { rows: orderRows } = await client.query(
        `INSERT INTO orders (order_number, customer_id, order_type, delivery_type, payment_type, payment_status, processing_status, subtotal_amount, usb_amount, total_amount, office_notes)
         VALUES ($1,$2,$3,$4,$5,'PENDING','WAITING_PAYMENT',$6,$7,$8,$9) RETURNING id`,
        [orderNumber, customerId, orderType, deliveryTypeErd, paymentType, subtotalAmount, usbAmount, total, officeNotes]
      );
      const orderId = orderRows[0].id;

      const storyIds = stories.filter(id => /^[0-9a-f-]{36}$/i.test(id));
      if (storyIds.length) {
        const { rows: storyRows } = await client.query(
          'SELECT id, story_code, title FROM stories WHERE id = ANY($1::uuid[])',
          [storyIds]
        );
        const unitPrice = storyRows.length ? +(subtotalAmount / storyRows.length).toFixed(2) : 0;
        for (const s of storyRows) {
          await client.query(
            `INSERT INTO order_items (order_id, story_id, story_code_snapshot, story_title_snapshot, unit_price)
             VALUES ($1,$2,$3,$4,$5)`,
            [orderId, s.id, s.story_code, s.title, unitPrice]
          );
        }
      }

      await client.query('COMMIT');
      return orderId;
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
      `SELECT o.id, o.order_type, o.payment_type, c.email
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

    return {
      orderType: order.order_type,
      paymentType: order.payment_type,
      recipientEmail: order.email,
      fileIds,
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
  async recordFulfillmentFailure(orderId, { errorCode, errorMessage, externalFolderId = null, itemResults = null, responseReceivedAt }) {
    await pool.query(
      `INSERT INTO fulfillment_requests (order_id, request_status, sharing_status, error_code, error_message, external_folder_id, item_results, response_received_at)
       VALUES ($1, 'FAILED', 'FAILED', $2, $3, $4, $5, $6)
       ON CONFLICT (order_id) DO UPDATE SET
         request_status = 'FAILED', sharing_status = 'FAILED', error_code = $2, error_message = $3,
         external_folder_id = $4, item_results = $5, response_received_at = $6, updated_at = now()`,
      [orderId, errorCode, errorMessage, externalFolderId, itemResults ? JSON.stringify(itemResults) : null, responseReceivedAt]
    );
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
      `SELECT o.*, c.full_name AS customer_name, c.email, c.phone
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
    };
  },

  async getOrders(status) {
    const whereSql = status && STATUS_FILTERS[status] ? `WHERE ${STATUS_FILTERS[status]}` : '';
    const { rows } = await pool.query(`
      SELECT
        o.id, o.order_number, o.payment_type, o.payment_status, o.processing_status,
        o.delivery_type, o.usb_amount, o.total_amount, o.folder_url, o.office_notes, o.created_at,
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

  async getCatalog() {
    const [{ rows: categories }, { rows: stories }] = await Promise.all([
      pool.query('SELECT id, name, display_order FROM categories WHERE is_active = true ORDER BY display_order'),
      pool.query(`
        SELECT s.id, s.story_code, s.category_id, s.title, s.duration_seconds
        FROM stories s
        JOIN categories c ON c.id = s.category_id
        WHERE s.is_active = true AND c.is_active = true
        ORDER BY c.display_order, s.story_code
      `),
    ]);
    return {
      categories: categories.map(c => ({ id: c.id, name: c.name, displayOrder: c.display_order })),
      stories: stories.map(s => ({
        id:              s.id,
        storyCode:       s.story_code,
        categoryId:      s.category_id,
        title:           s.title,
        durationMinutes: s.duration_seconds ? Math.round(s.duration_seconds / 60) : null,
      })),
    };
  },

  async getKPI() {
    const today = new Date().toISOString().slice(0, 10);
    const firstOfMonth = today.slice(0, 7) + '-01';
    const [ordersToday, requiresAttention, failedPayments, leadsOnly, paidCreditOrders, monthlyRevenue, usbOrders] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS n FROM orders WHERE created_at::date = $1', [today]),
      pool.query("SELECT COUNT(*)::int AS n FROM orders WHERE payment_status = 'PENDING' AND payment_type IN ('BANK_TRANSFER','CALLBACK')"),
      pool.query("SELECT COUNT(*)::int AS n FROM orders WHERE payment_status IN ('FAILED','CANCELLED')"),
      pool.query('SELECT COUNT(*)::int AS n FROM leads'),
      pool.query("SELECT COUNT(*)::int AS n FROM orders WHERE payment_status = 'PAID'"),
      pool.query("SELECT COALESCE(SUM(total_amount),0)::float AS n FROM orders WHERE payment_status = 'PAID' AND created_at >= $1", [firstOfMonth]),
      pool.query('SELECT COUNT(*)::int AS n FROM orders WHERE usb_amount IS NOT NULL'),
    ]);
    return {
      ordersToday:       ordersToday.rows[0].n,
      requiresAttention: requiresAttention.rows[0].n,
      failedPayments:    failedPayments.rows[0].n,
      leadsOnly:         leadsOnly.rows[0].n,
      paidCreditOrders:  paidCreditOrders.rows[0].n,
      monthlyRevenue:    monthlyRevenue.rows[0].n,
      usbOrders:         usbOrders.rows[0].n,
      systemErrors:      0,
    };
  },
};
