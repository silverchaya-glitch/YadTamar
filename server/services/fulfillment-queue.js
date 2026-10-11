// תור ניסיונות חוזרים למסירת קבצים: הזמנה ששולמה והמסירה שלה נכשלה (גם אחרי הניסיון
// המיידי ב-fulfillment.js) נכנסת לתור דרך db.recordFulfillmentFailure, וכאן מנסים
// שוב לאורך כ-40 דקות — הזמנה אחת בכל פעם, כדי לא להעמיס על ה-Apps Script (שמעבד
// בקשה אחת בכל פעם, LOCK_TIMEOUT). הצלחה → מייל "התוכן שלך מוכן" ללקוח. כל הניסיונות
// נכשלו → מייל התראה נפרד למשרד. המצב נשמר ב-fulfillment_requests (next_retry_at,
// retry_count, alert_sent_at), כך שריסטרט של השרת לא מאבד הזמנות בתור.
const db = require('../db');
const { confirmManualPayment } = require('./fulfillment');
const { sendFileDelivery, sendFulfillmentFailedAlert } = require('./email');

// המתנה אחרי ניסיון התור ה-n (הניסיון הראשון בתור — דקה אחרי הכישלון המקורי)
const RETRY_DELAYS_MS = [2, 5, 10, 20].map(m => m * 60 * 1000);
const MAX_QUEUE_ATTEMPTS = RETRY_DELAYS_MS.length + 1;
const TICK_MS = 30 * 1000;

let running = false;

async function processOne(orderId, retryCount) {
  const result = await confirmManualPayment(orderId);

  if (result.success && result.sharingStatus === 'SHARED') {
    console.log(`[fulfillment-queue] order ${orderId} delivered on queue attempt ${retryCount}`);
    if (!(await db.hasOrderEmail(orderId, 'FILE_DELIVERY'))) {
      const order = await db.getOrderForPayment(orderId);
      if (order) {
        await sendFileDelivery({
          orderId: order.id,
          customerId: order.customerId,
          customerName: order.customerName,
          email: order.email,
          folderUrl: result.externalFolderUrl,
        });
      }
    }
    return;
  }

  // WAITING_MANUAL/NOT_APPLICABLE לא אמורים לקרות להזמנה ששולמה — אם כן, מתייחסים
  // כמו לכישלון, כדי שהמשרד יקבל התראה בסוף ולא יישאר לקוח בלי קבצים.
  const errorCode = result.success ? `UNEXPECTED_${result.sharingStatus}` : result.errorCode;
  if (retryCount < MAX_QUEUE_ATTEMPTS) {
    const delay = RETRY_DELAYS_MS[retryCount - 1];
    console.warn(`[fulfillment-queue] order ${orderId} attempt ${retryCount}/${MAX_QUEUE_ATTEMPTS} failed (${errorCode}) — next in ${delay / 60000} min`);
    await db.scheduleFulfillmentRetry(orderId, delay);
    return;
  }

  console.error(`[fulfillment-queue] order ${orderId} — all ${MAX_QUEUE_ATTEMPTS} queue attempts failed (${errorCode}), alerting office`);
  await db.markFulfillmentAlerted(orderId);
  const order = await db.getOrderForPayment(orderId);
  const fr = await db.getFulfillmentRequest(orderId);
  await sendFulfillmentFailedAlert({
    order,
    errorCode: (fr && fr.errorCode) || errorCode,
    errorMessage: (fr && fr.errorMessage) || result.errorMessage || '',
    attempts: MAX_QUEUE_ATTEMPTS,
  });
}

async function tick() {
  if (running) return;
  running = true;
  try {
    let job;
    while ((job = await db.claimFulfillmentRetry())) {
      try {
        await processOne(job.orderId, job.retryCount);
      } catch (e) {
        console.error(`[fulfillment-queue] order ${job.orderId} unexpected error: ${e.message}`);
      }
    }
  } catch (e) {
    console.error(`[fulfillment-queue] tick failed: ${e.message}`);
  } finally {
    running = false;
  }
}

function startFulfillmentQueue() {
  setInterval(tick, TICK_MS).unref();
}

module.exports = { startFulfillmentQueue, tick, RETRY_DELAYS_MS, MAX_QUEUE_ATTEMPTS };
