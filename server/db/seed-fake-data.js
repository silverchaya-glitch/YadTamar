// ============================================================
// FAKE DATA — DELETE BEFORE PRODUCTION
// נתוני דמה זמניים לבדיקת הזרימה מקצה לקצה בלבד.
// לא נתונים אמיתיים. יש למחוק את כל השורות שנוצרות כאן (customers,
// orders, order_items, payments, fulfillment_requests, email_logs, leads)
// לפני שהאתר עולה לפרודקשן עם לקוחות אמיתיים.
// להרצה: node server/db/seed-fake-data.js
// ============================================================

require('dotenv').config();
const { Pool } = require('pg');

async function main() {
  const pool = new Pool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: sampleStories } = await client.query(
      `SELECT id, story_code, title FROM stories WHERE google_drive_file_id NOT LIKE 'PENDING%' ORDER BY story_code LIMIT 10`
    );
    if (sampleStories.length < 3) throw new Error('אין מספיק סיפורים בקטלוג — הריצי קודם seed-catalog.js');

    const customers = [
      { full_name: 'דוגמה - ישראל ישראלי', email: 'demo.israel@example.com', phone: '050-0000001' },
      { full_name: 'דוגמה - רבקה כהן', email: 'demo.rivka@example.com', phone: '050-0000002' },
      { full_name: 'דוגמה - משה לוי', email: 'demo.moshe@example.com', phone: '050-0000003' },
      { full_name: 'דוגמה - שרה גולד', email: 'demo.sara@example.com', phone: '050-0000004' },
    ];
    const customerIds = [];
    for (const c of customers) {
      const { rows } = await client.query(
        `INSERT INTO customers (full_name, email, phone) VALUES ($1,$2,$3) RETURNING id`,
        [c.full_name, c.email, c.phone]
      );
      customerIds.push(rows[0].id);
    }

    const orderDefs = [
      { num: 'DEMO-0001', customer: 0, type: 'STORY_SELECTION', delivery: 'SELECTED_STORIES', payType: 'CREDIT_CARD', payStatus: 'PAID', procStatus: 'COMPLETED', items: [0, 1, 2], usb: 15 },
      { num: 'DEMO-0002', customer: 1, type: 'FULL_LIBRARY', delivery: 'MASTER_LIBRARY', payType: 'BANK_TRANSFER', payStatus: 'PENDING', procStatus: 'WAITING_PAYMENT', items: [], usb: null },
      { num: 'DEMO-0003', customer: 2, type: 'STORY_SELECTION', delivery: 'SELECTED_STORIES', payType: 'CALLBACK', payStatus: 'FAILED', procStatus: 'FAILED', items: [3, 4], usb: null },
      { num: 'DEMO-0004', customer: 3, type: 'ADULT_COLLECTION', delivery: 'ADULT_COLLECTION', payType: 'CREDIT_CARD', payStatus: 'PAID', procStatus: 'READY_FOR_FULFILLMENT', items: [], usb: 0 },
      { num: 'DEMO-0005', customer: 0, type: 'STORY_SELECTION', delivery: 'GIFT_STORY', payType: 'CREDIT_CARD', payStatus: 'PAID', procStatus: 'PROCESSING', items: [5], usb: null },
      { num: 'DEMO-0006', customer: 1, type: 'STORY_SELECTION', delivery: 'SELECTED_STORIES', payType: 'CREDIT_CARD', payStatus: 'CANCELLED', procStatus: 'CREATED', items: [6, 7], usb: null },
    ];

    for (const def of orderDefs) {
      const items = def.items.map(i => sampleStories[i]);
      const unitPrice = 8;
      const subtotal = items.length ? items.length * unitPrice : (def.type === 'FULL_LIBRARY' ? 1550 : def.type === 'ADULT_COLLECTION' ? 360 : 0);
      const usbAmount = def.usb;
      const total = subtotal + (usbAmount || 0);

      const { rows: orderRows } = await client.query(
        `INSERT INTO orders (order_number, customer_id, order_type, delivery_type, payment_type, payment_status, processing_status, subtotal_amount, usb_amount, total_amount, folder_url, office_notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [def.num, customerIds[def.customer], def.type, def.delivery, def.payType, def.payStatus, def.procStatus, subtotal, usbAmount, total,
         def.procStatus === 'COMPLETED' ? 'https://drive.google.com/drive/folders/DEMO-FOLDER-PLACEHOLDER' : null,
         'הזמנת דמה — לצורך בדיקה בלבד']
      );
      const orderId = orderRows[0].id;

      for (const story of items) {
        await client.query(
          `INSERT INTO order_items (order_id, story_id, story_code_snapshot, story_title_snapshot, unit_price)
           VALUES ($1,$2,$3,$4,$5)`,
          [orderId, story.id, story.story_code, story.title, unitPrice]
        );
      }

      if (def.payStatus !== 'PENDING') {
        await client.query(
          `INSERT INTO payments (order_id, provider, provider_transaction_id, amount, status, raw_response_json)
           VALUES ($1,'HYP',$2,$3,$4,$5)`,
          [orderId, `DEMO-TXN-${def.num}`, total,
           def.payStatus === 'PAID' ? 'APPROVED' : def.payStatus === 'FAILED' ? 'FAILED' : 'PENDING',
           JSON.stringify({ demo: true, note: 'תגובת דמה' })]
        );
      }

      await client.query(
        `INSERT INTO fulfillment_requests (order_id, request_status, attempts_count, sharing_status)
         VALUES ($1,$2,$3,$4)`,
        [orderId,
         def.procStatus === 'COMPLETED' ? 'COMPLETED' : def.procStatus === 'PROCESSING' ? 'SENT' : 'PENDING',
         def.procStatus === 'CREATED' ? 0 : 1,
         def.procStatus === 'COMPLETED' ? 'SHARED' : 'PENDING']
      );

      await client.query(
        `INSERT INTO email_logs (order_id, customer_id, email_type, recipient_email, send_status, sent_at)
         VALUES ($1,$2,'PURCHASE_CONFIRMATION',$3,$4,$5)`,
        [orderId, customerIds[def.customer], customers[def.customer].email,
         def.payStatus === 'PAID' ? 'SENT' : 'PENDING',
         def.payStatus === 'PAID' ? new Date() : null]
      );
    }

    const leads = [
      { full_name: 'דוגמה - ליד מתנה', email: 'demo.lead1@example.com', phone: '050-1000001', source: 'GIFT_STORY' },
      { full_name: 'דוגמה - ליד שיחה חוזרת', email: 'demo.lead2@example.com', phone: '050-1000002', source: 'CALLBACK_REQUEST' },
      { full_name: 'דוגמה - ליד שיווקי', email: 'demo.lead3@example.com', phone: null, source: 'MARKETING' },
    ];
    for (const l of leads) {
      await client.query(
        `INSERT INTO leads (full_name, email, phone, source, gift_sent) VALUES ($1,$2,$3,$4,$5)`,
        [l.full_name, l.email, l.phone, l.source, l.source === 'GIFT_STORY']
      );
    }

    await client.query('COMMIT');
    console.log(`נזרעו נתוני דמה: ${customers.length} לקוחות, ${orderDefs.length} הזמנות, ${leads.length} לידים.`);
    console.log('⚠️  זכרי למחוק את כל הנתונים האלה לפני מעבר לפרודקשן (חפשי "DEMO-" ו-"demo." בטבלאות customers/orders/leads).');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
