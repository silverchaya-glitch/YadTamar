const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '../../yadtamar.db');
const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT NOT NULL,
    delivery_type TEXT NOT NULL CHECK(delivery_type IN ('DRIVE','USB')),
    items TEXT NOT NULL,
    total REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK(status IN ('pending','pending_manual','paid','failed','fulfilled')),
    drive_folder_url TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT,
    gift_story_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Add columns idempotently (ALTER TABLE does not support IF NOT EXISTS in SQLite)
[
  'ALTER TABLE orders ADD COLUMN notes TEXT DEFAULT ""',
  'ALTER TABLE orders ADD COLUMN fulfillment_status TEXT',
  'ALTER TABLE leads ADD COLUMN gift_sent INTEGER DEFAULT 0',
].forEach(sql => { try { db.exec(sql); } catch {} });

function mapOrder(row) {
  const items = (() => {
    try {
      let parsed = JSON.parse(row.items);
      if (typeof parsed === 'string') parsed = JSON.parse(parsed);
      return (typeof parsed === 'object' && parsed !== null) ? parsed : {};
    } catch { return {}; }
  })();
  const statusMap = {
    pending:        { paymentStatus: 'PENDING', processingStatus: 'WAITING_PAYMENT',       fulfillmentStatus: null },
    pending_manual: { paymentStatus: 'PENDING', processingStatus: 'WAITING_PAYMENT',       fulfillmentStatus: null },
    paid:           { paymentStatus: 'PAID',    processingStatus: 'READY_FOR_FULFILLMENT', fulfillmentStatus: 'PENDING' },
    failed:         { paymentStatus: 'FAILED',  processingStatus: 'FAILED',                fulfillmentStatus: null },
    fulfilled:      { paymentStatus: 'PAID',    processingStatus: 'COMPLETED',             fulfillmentStatus: 'COMPLETED' },
  };
  const s = statusMap[row.status] || statusMap.pending;
  const product = items.product || 'STORY_SELECTION';
  const stories = Array.isArray(items.stories) ? items.stories : [];

  let deliveryType;
  if (product === 'MASTER_LIBRARY')        deliveryType = 'MASTER_LIBRARY';
  else if (product === 'ADULT_COLLECTION') deliveryType = 'ADULT_COLLECTION';
  else                                     deliveryType = 'SELECTED_STORIES';

  return {
    id:               String(row.id),
    orderNumber:      'YT-' + String(row.id).padStart(4, '0'),
    customerName:     row.customer_name,
    email:            row.email,
    phone:            row.phone,
    amount:           row.total,
    paymentType:      items.paymentType || 'CREDIT_CARD',
    paymentStatus:    s.paymentStatus,
    processingStatus: s.processingStatus,
    deliveryType,
    fulfillmentStatus: row.fulfillment_status || s.fulfillmentStatus,
    usb:              row.delivery_type === 'USB',
    folderUrl:        row.drive_folder_url || '',
    filesCount:       stories.length,
    notes:            row.notes || '',
    createdAt:        row.created_at || '',
  };
}

function mapLead(row) {
  return {
    id:        String(row.id),
    name:      row.name,
    email:     row.email,
    phone:     row.phone || '',
    source:    row.gift_story_id ? 'GIFT_STORY' : 'CALLBACK',
    giftSent:  Boolean(row.gift_sent),
    createdAt: row.created_at || '',
  };
}

module.exports = {
  createOrder(data) {
    const stmt = db.prepare(`
      INSERT INTO orders (customer_name, phone, email, delivery_type, items, total, status)
      VALUES (@customer_name, @phone, @email, @delivery_type, @items, @total, @status)
    `);
    const result = stmt.run({
      ...data,
      items: JSON.stringify(data.items),
      status: data.status || 'pending'
    });
    return result.lastInsertRowid;
  },

  updateOrder(id, fields) {
    const keys = Object.keys(fields);
    const set = keys.map(k => `${k} = @${k}`).join(', ');
    db.prepare(`UPDATE orders SET ${set} WHERE id = @id`).run({ ...fields, id });
  },

  updateLead(id, fields) {
    const keys = Object.keys(fields);
    const set = keys.map(k => `${k} = @${k}`).join(', ');
    db.prepare(`UPDATE leads SET ${set} WHERE id = @id`).run({ ...fields, id });
  },

  getOrder(id) {
    const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
    if (!row) return null;
    return { ...row, items: JSON.parse(row.items) };
  },

  getOrders(status) {
    const rows = status
      ? db.prepare('SELECT * FROM orders WHERE status = ? ORDER BY created_at DESC').all(status)
      : db.prepare('SELECT * FROM orders ORDER BY created_at DESC').all();
    return rows.map(mapOrder);
  },

  createLead(data) {
    const stmt = db.prepare(`
      INSERT INTO leads (name, email, phone, gift_story_id)
      VALUES (@name, @email, @phone, @gift_story_id)
    `);
    return stmt.run(data).lastInsertRowid;
  },

  getLeads() {
    return db.prepare('SELECT * FROM leads ORDER BY created_at DESC').all().map(mapLead);
  },

  getKPI() {
    const today = new Date().toISOString().slice(0, 10);
    const firstOfMonth = today.slice(0, 7) + '-01';
    return {
      ordersToday:       db.prepare("SELECT COUNT(*) as n FROM orders WHERE date(created_at) = ?").get(today).n,
      requiresAttention: db.prepare("SELECT COUNT(*) as n FROM orders WHERE status = 'pending_manual'").get().n,
      failedPayments:    db.prepare("SELECT COUNT(*) as n FROM orders WHERE status = 'failed'").get().n,
      leadsOnly:         db.prepare("SELECT COUNT(*) as n FROM leads").get().n,
      paidCreditOrders:  db.prepare("SELECT COUNT(*) as n FROM orders WHERE status IN ('paid','fulfilled')").get().n,
      monthlyRevenue:    db.prepare("SELECT COALESCE(SUM(total),0) as n FROM orders WHERE status IN ('paid','fulfilled') AND date(created_at) >= ?").get(firstOfMonth).n,
      usbOrders:         db.prepare("SELECT COUNT(*) as n FROM orders WHERE delivery_type = 'USB'").get().n,
      systemErrors:      0,
    };
  },
};
