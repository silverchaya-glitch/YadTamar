const crypto = require('crypto');
const db = require('../db');

const TIMEOUT_MS = 60_000;

// שלב 1: קורא ל-webhook החיצוני (Google Apps Script) שיוצר תיקיית Drive ומעתיק
// אליה את הקבצים הרלוונטיים להזמנה. מחזיר folder ID + החלטת שיתוף-מיידי מול
// המתנה-לאישור-תשלום-ידני (sharingStatus) — ההחלטה עצמה (מבוססת paymentType)
// עדיין מחושבת בסקריפט הקיים, לא שוכפלה כאן (ראו PROGRESS.txt). לא זורק לעולם.
async function callFolderCreationWebhook(orderId, order, requestId) {
  const url = process.env.FULFILLMENT_WEBHOOK_URL;
  const secret = process.env.FULFILLMENT_WEBHOOK_SECRET;
  if (!url || !secret) {
    return { success: false, errorCode: 'CONFIG_MISSING', errorMessage: 'FULFILLMENT_WEBHOOK_URL/FULFILLMENT_WEBHOOK_SECRET not configured' };
  }

  const body = {
    secret,
    orderId,
    orderNumber: order.orderNumber,
    requestId,
    fileIds: order.fileIds,
    recipientEmail: order.recipientEmail,
    permission: 'viewer',
    paymentType: order.paymentType,
    requestType: order.orderType,
  };

  // הבקשה נשלחת כ-GET עם ה-payload ב-query string (לא POST) — נמצא שחשבון הגוגל
  // חוסם כל POST ל-Apps Script Web App שלו (מאומת גם בפרויקט ריק חדש), בעוד ש-GET
  // עובד תקין. ה-Apps Script (doGet) קורא את ה-payload מ-e.parameter.payload.
  const requestUrl = `${url}?payload=${encodeURIComponent(JSON.stringify(body))}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(requestUrl, { method: 'GET', signal: controller.signal });
    const text = await resp.text();
    const data = (() => { try { return JSON.parse(text); } catch { return null; } })();

    if (data && data.alreadyProcessed) {
      console.log(`[fulfillment] order ${orderId} folder creation already processed (requestId=${requestId})`);
    }

    if (data && data.success) {
      return {
        success: true,
        requestStatus: data.requestStatus,
        sharingStatus: data.sharingStatus,
        externalFolderId: data.externalFolderId,
        externalFolderUrl: data.externalFolderUrl,
        itemResults: data.itemResults,
      };
    }

    const errorCode = (data && data.errorCode) || `HTTP_${resp.status}`;
    const errorMessage = (data && data.errorMessage) || `Unexpected response (HTTP ${resp.status})`;
    return {
      success: false, errorCode, errorMessage,
      externalFolderId: data && data.externalFolderId,
      itemResults: data && data.itemResults,
    };
  } catch (err) {
    const errorCode = err.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR';
    return { success: false, errorCode, errorMessage: err.message };
  } finally {
    clearTimeout(timer);
  }
}

// שלב 2: קורא ל-shareLib (apps-script/share-lib.gs, פריסה נפרדת מהסקריפט הקיים)
// שמשתף בפועל תיקייה/קובץ קיימים עם הלקוח, ושולח מייל התראה. אימות per-customer:
// email_from קבוע (SHARE_CUSTOMER_EMAIL) + token מחושב-מראש (SHARE_CUSTOMER_TOKEN,
// מ-_verifyToken() בעורך הסקריפט) — ה-SECRET של shareLib עצמו אף פעם לא נשמר אצלנו.
// לא זורק לעולם.
async function callShareWebhook(folderId, recipientEmail, requestId) {
  const url = process.env.SHARE_WEBHOOK_URL;
  const emailFrom = process.env.SHARE_CUSTOMER_EMAIL;
  const token = process.env.SHARE_CUSTOMER_TOKEN;
  if (!url || !emailFrom || !token) {
    return { success: false, errorCode: 'CONFIG_MISSING', errorMessage: 'SHARE_WEBHOOK_URL/SHARE_CUSTOMER_EMAIL/SHARE_CUSTOMER_TOKEN not configured' };
  }

  const params = new URLSearchParams({
    email_from: emailFrom,
    token,
    recipientEmail,
    fileId: folderId,
    permission: 'viewer',
  });
  const requestUrl = `${url}?${params.toString()}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(requestUrl, { method: 'GET', signal: controller.signal });
    const text = await resp.text();
    const data = (() => { try { return JSON.parse(text); } catch { return null; } })();

    if (data && data.success) {
      return { success: true, message: data.message, requestId: data.requestId };
    }

    const errorMessage = (data && data.message) || `Unexpected response (HTTP ${resp.status})`;
    return { success: false, errorCode: `HTTP_${resp.status}`, errorMessage };
  } catch (err) {
    const errorCode = err.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR';
    return { success: false, errorCode, errorMessage: err.message };
  } finally {
    clearTimeout(timer);
  }
}

// צינור דו-שלבי: שלב 1 יוצר תיקיית Drive + מעתיק קבצים (או, ל-FULL_LIBRARY, משתמש
// ישירות בתיקיית ה-Master הקבועה בלי לקרוא לשלב 1 כלל — אין מה להעתיק, PRD §13).
// שלב 2 (shareLib) משתף בפועל את התיקייה עם הלקוח — נקרא רק כשההחלטה משלב 1
// אינה WAITING_MANUAL (המתנה לאישור תשלום ידני; הלוגיקה הזו, מבוססת paymentType,
// נשארת בסקריפט הקיים ולא שוכפלה כאן).
// לא זורק לעולם — הקוראים (POST /api/orders, PATCH /api/admin/orders/:id) לא
// עוטפים את הקריאה הזו ב-try/catch משלהם.
async function triggerFulfillment(orderId) {
  try {
    const order = await db.getOrderForFulfillment(orderId);
    if (!order) {
      console.error(`[fulfillment] order not found: ${orderId}`);
      return { success: false, errorCode: 'ORDER_NOT_FOUND' };
    }

    // הסקריפט (Apps Script) לא תומך ב-ADULT_COLLECTION/GEMARA בכלל — לא שולחים אליו,
    // ולא כותבים fulfillment_requests כדי שזה לא ייראה כ"כישלון" באדמין. גמרא מסופקת
    // בדיסק און קי בלבד (מפורש, מפאת גודל הקבצים) — מילוי ידני של המשרד, כמו אוסף מבוגרים.
    if (order.orderType === 'ADULT_COLLECTION' || order.orderType === 'GEMARA') {
      return { success: false, errorCode: 'NOT_APPLICABLE' };
    }

    await db.recordFulfillmentAttempt(orderId, new Date());
    const requestId = crypto.randomUUID();

    let folderId;
    let folderUrl;
    let sharingDecision; // 'WAITING_MANUAL' עוצר לפני שלב 2; כל ערך אחר = שתף עכשיו
    let itemResults;

    if (order.orderType === 'FULL_LIBRARY') {
      // נקודה פתוחה: MASTER_LIBRARY_FOLDER_ID עדיין לא נמסר — ראו FOLLOWUPS.md.
      const masterFolderId = process.env.MASTER_LIBRARY_FOLDER_ID;
      if (!masterFolderId) {
        const errorMessage = 'MASTER_LIBRARY_FOLDER_ID not configured — FULL_LIBRARY sharing blocked (see FOLLOWUPS.md)';
        console.error(`[fulfillment] ${errorMessage}`);
        await db.recordFulfillmentFailure(orderId, { errorCode: 'CONFIG_MISSING', errorMessage, responseReceivedAt: new Date() });
        return { success: false, errorCode: 'CONFIG_MISSING', errorMessage };
      }
      folderId = masterFolderId;
      sharingDecision = 'SHARE_NOW';
    } else {
      const stage1 = await callFolderCreationWebhook(orderId, order, requestId);
      if (!stage1.success) {
        console.error(`[fulfillment] order ${orderId} folder creation failed: ${stage1.errorCode} — ${stage1.errorMessage}`);
        await db.recordFulfillmentFailure(orderId, {
          errorCode: stage1.errorCode,
          errorMessage: stage1.errorMessage,
          externalFolderId: stage1.externalFolderId,
          itemResults: stage1.itemResults,
          responseReceivedAt: new Date(),
        });
        return { success: false, errorCode: stage1.errorCode, errorMessage: stage1.errorMessage };
      }
      folderId = stage1.externalFolderId;
      folderUrl = stage1.externalFolderUrl;
      sharingDecision = stage1.sharingStatus;
      itemResults = stage1.itemResults;
    }

    if (sharingDecision === 'WAITING_MANUAL') {
      console.log(`[fulfillment] order ${orderId} folder ready, waiting for manual payment confirmation before sharing`);
      await db.recordFulfillmentSuccess(orderId, {
        requestStatus: 'COMPLETED',
        sharingStatus: 'WAITING_MANUAL',
        externalFolderId: folderId,
        externalFolderUrl: folderUrl,
        sharedEmail: null,
        itemResults,
        responseReceivedAt: new Date(),
      });
      return { success: true, externalFolderUrl: folderUrl, sharingStatus: 'WAITING_MANUAL' };
    }

    const stage2 = await callShareWebhook(folderId, order.recipientEmail, requestId);
    if (!stage2.success) {
      console.error(`[fulfillment] order ${orderId} share failed: ${stage2.errorCode} — ${stage2.errorMessage}`);
      await db.recordFulfillmentFailure(orderId, {
        errorCode: stage2.errorCode,
        errorMessage: stage2.errorMessage,
        externalFolderId: folderId,
        itemResults,
        responseReceivedAt: new Date(),
      });
      return { success: false, errorCode: stage2.errorCode, errorMessage: stage2.errorMessage };
    }

    await db.recordFulfillmentSuccess(orderId, {
      requestStatus: 'COMPLETED',
      sharingStatus: 'SHARED',
      externalFolderId: folderId,
      externalFolderUrl: folderUrl,
      sharedEmail: order.recipientEmail,
      itemResults,
      responseReceivedAt: new Date(),
    });
    return { success: true, externalFolderUrl: folderUrl, sharingStatus: 'SHARED' };
  } catch (err) {
    console.error(`[fulfillment] unexpected error for order ${orderId}: ${err.message}`);
    return { success: false, errorCode: 'INTERNAL_ERROR', errorMessage: err.message };
  }
}

module.exports = { triggerFulfillment, callShareWebhook };
