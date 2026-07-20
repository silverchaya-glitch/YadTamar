// ============================================================
// כלי ניקוי ידני לשורות דמו (email LIKE 'demo.%' / order_number LIKE 'DEMO-%')
// שנוצרו ע"י qa/orders-mutating.test.js, qa/orders-fulfillment-webhook.test.js,
// או server/db/seed-fake-data.js. לעולם לא מופעל אוטומטית משום סקריפט אחר —
// זו החלטה ידנית ומפורשת בכל פעם (כפי שהוחלט 2026-07-19).
//
// ברירת מחדל: dry-run בלבד (מציג מה יימחק, לא נוגע ב-DB).
// מחיקה בפועל: node qa/cleanup.js --confirm  (ידרוש גם הקלדת "DELETE" באינטראקציה)
//
// שים לב: לא מוחק תיקיות Drive אמיתיות שנוצרו ע"י qa/orders-fulfillment-webhook.test.js —
// לסקריפט הזה אין גישת Drive API. תיקיות כאלה יש למחוק ידנית מ-Drive עצמו.
// ============================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const readline = require('readline');
const { Pool } = require('pg');

const DRY_RUN = !process.argv.includes('--confirm');

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans); }));
}

async function main() {
  const pool = new Pool();
  const client = await pool.connect();
  try {
    const { rows: demoOrders } = await client.query(`
      SELECT o.id, o.order_number, c.email FROM orders o
      JOIN customers c ON c.id = o.customer_id
      WHERE o.order_number LIKE 'DEMO-%' OR c.email LIKE 'demo.%'
    `);
    const { rows: demoCustomers } = await client.query(`SELECT id, email FROM customers WHERE email LIKE 'demo.%'`);
    const { rows: demoLeads } = await client.query(`SELECT id, email FROM leads WHERE email LIKE 'demo.%'`);

    console.log(`נמצאו: ${demoOrders.length} הזמנות דמו, ${demoCustomers.length} לקוחות דמו, ${demoLeads.length} לידים דמו.`);
    demoOrders.forEach(o => console.log(`  order ${o.order_number} (${o.id}) — ${o.email}`));
    demoCustomers.forEach(c => console.log(`  customer ${c.id} — ${c.email}`));
    demoLeads.forEach(l => console.log(`  lead ${l.id} — ${l.email}`));

    if (!demoOrders.length && !demoCustomers.length && !demoLeads.length) {
      console.log('אין מה לנקות.');
      return;
    }

    if (DRY_RUN) {
      console.log('\n(dry-run — שום דבר לא נמחק. להרצה בפועל: node qa/cleanup.js --confirm)');
      return;
    }

    const answer = await ask(`\nלהקליד בדיוק "DELETE" כדי למחוק את כל השורות שלמעלה לצמיתות: `);
    if (answer !== 'DELETE') {
      console.log('בוטל — לא הוקלד "DELETE" בדיוק.');
      return;
    }

    const orderIds = demoOrders.map(o => o.id);
    const customerIds = demoCustomers.map(c => c.id);

    await client.query('BEGIN');
    if (orderIds.length) {
      await client.query('DELETE FROM email_logs WHERE order_id = ANY($1::uuid[])', [orderIds]);
      await client.query('DELETE FROM fulfillment_requests WHERE order_id = ANY($1::uuid[])', [orderIds]);
      await client.query('DELETE FROM payments WHERE order_id = ANY($1::uuid[])', [orderIds]);
      await client.query('DELETE FROM order_items WHERE order_id = ANY($1::uuid[])', [orderIds]);
      await client.query('DELETE FROM orders WHERE id = ANY($1::uuid[])', [orderIds]);
    }
    if (customerIds.length) {
      await client.query('DELETE FROM email_logs WHERE customer_id = ANY($1::uuid[])', [customerIds]);
      await client.query('DELETE FROM customers WHERE id = ANY($1::uuid[])', [customerIds]);
    }
    await client.query(`DELETE FROM leads WHERE email LIKE 'demo.%'`);
    await client.query('COMMIT');

    console.log('נוקה בהצלחה.');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
