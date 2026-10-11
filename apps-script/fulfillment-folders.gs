/**
 * ============================================================
 *  עותק-ייחוס (reference copy) — לא מורץ ע"י שרת ה-Node
 * ============================================================
 *  סקריפט יצירת תיקיות ההזמנה (FULFILLMENT_WEBHOOK_URL, שלב 1 ב-server/services/fulfillment.js).
 *  המקור החי: Apps Script 1guEk38seafJ1OxBHisO0zctU3EVGLZFJYXfqX-Io2rkxyuP-Fx_DdfA7 — עורכים שם
 *  (או clasp push) ומעדכנים את ההפצה החיה; כאן רק עותק לגיבוי ולמעקב שינויים.
 *  הועתק 2026-10-11, אחרי הוספת CALLBACK ל-ALLOWED_PAYMENT_TYPES (הפצה @21).
 *  CUSTOMER_TOKEN הוחלף ב-<REDACTED> — הערך האמיתי קיים רק בסקריפט החי.
 */

/**
 * ============================================================
 *  קובץ מאוחד - Client_Code_Merged_v3.gs
 *  ------------------------------------------------------------
 *  חלק א': הסקריפט המקורי (Client_Code.gs) - AS IS, ללא שום שינוי.
 *  חלק ב': Fulfillment_Copy_And_Share.gs - גרסה 3:
 *          שני מסלולים לפי paymentType.
 *
 *  שינויים בגרסה 2 (מסומנים "// v2"):
 *   1. שדות חדשים בבקשה: paymentType, requestType (חובה).
 *   2. ולידציה: permission חייב להיות viewer או editor.
 *   3. עמודות paymentType, requestType בגיליון "לוג בקשות מימוש".
 *   4. התשובה מחזירה גם paymentType ו-requestType.
 *
 *  שינויים בגרסה 3 (מסומנים "// v3"):
 *   1. שני מסלולים לפי paymentType:
 *      - CREDIT_CARD: העתקה + שיתוף אוטומטי עם הלקוח (כמו קודם).
 *      - BANK_TRANSFER / CASH / CALLBACK: העתקה בלבד, ללא שיתוף.
 *        התשובה חוזרת עם sharingStatus = "WAITING_MANUAL"
 *        והמשרד משתף ידנית אחרי אימות התשלום.
 *   2. ולידציה קשיחה: paymentType חייב להיות אחד משלושת הערכים.
 *   3. הסקריפט לא שולח מיילים בכלל - האתר מטפל בשליחה לפי התשובה.
 *   4. _testDoPost קורא את הסוד מ-Script Properties (לא קבוע בקוד),
 *      כך שה-secret חייב להיות מוגדר ותקף גם בבדיקות.
 * ============================================================
 */


/* ============================================================
 * חלק א' - הסקריפט המקורי (AS IS)
 * ============================================================ */

// v4: SpreadsheetApp.getActiveSpreadsheet() לא עובד בהרצת Web App (doGet/doPost דרך
// HTTP) - אין "active spreadsheet" בהקשר כזה. משתמשים ב-ID מפורש במקום.
const BOUND_SPREADSHEET_ID = '1LWwK41k-wcsqJh_5VMTZmpefEltjcp5_HAEka3f2gjg';
function _getBoundSpreadsheet() {
  return SpreadsheetApp.openById(BOUND_SPREADSHEET_ID);
}

function authorizeNow() {
  // הרשאת Drive מלאה - יוצר קובץ זמני ומוחק אותו מיד
  DriveApp.createFile('_auth_test', 'x', MimeType.PLAIN_TEXT).setTrashed(true);
_getBoundSpreadsheet();
  // הרשאת Gmail
  GmailApp.getInboxThreads(0, 1);

  // הרשאת Session
  Session.getActiveUser().getEmail();
}

function _verifyToken() {
  console.log(ShareLib.generateToken(Session.getActiveUser().getEmail())); // המייל המדויק מ-CUSTOMER_EMAIL
}
var timestamp = new Date();

function authorizeAllScopes() {
  console.log('מתחילה תהליך הרשאה...');

  // Session
  const email = Session.getEffectiveUser().getEmail();
  console.log('Session:', email || '(ריק)');

  // GmailApp
  try {
    GmailApp.getUserLabelByName('bogus-label-just-for-auth');
    console.log('Gmail: הרשאה תקינה');
  } catch (e) {
    console.log('Gmail: ' + e.message);
  }

  // MailApp
  try {
    const quota = MailApp.getRemainingDailyQuota();
    console.log('Mail: הרשאה תקינה, מכסה נותרת -', quota);
  } catch (e) {
    console.log('Mail: ' + e.message);
  }

  // SpreadsheetApp (רק אם הוגדר LOG_SHEET_ID)
  try {
    const sheetId = PropertiesService.getScriptProperties().getProperty('LOG_SHEET_ID');
    if (sheetId) {
      SpreadsheetApp.openById(sheetId);
      console.log('Sheets: הרשאה תקינה');
    } else {
      console.log('Sheets: לא הוגדר LOG_SHEET_ID, מדלגת');
    }
  } catch (e) {
    console.log('Sheets: ' + e.message);
  }

  // UrlFetchApp
  try {
    UrlFetchApp.fetch('https://www.google.com', { muteHttpExceptions: true });
    console.log('UrlFetch: הרשאה תקינה');
  } catch (e) {
    console.log('UrlFetch: ' + e.message);
  }

  // PropertiesService + LockService
  try {
    PropertiesService.getScriptProperties().getProperties();
    LockService.getScriptLock();
    console.log('Properties/Lock: הרשאה תקינה');
  } catch (e) {
    console.log('Properties/Lock: ' + e.message);
  }

  console.log('סיום. אם לא קפץ מסך אישור הרשאות - כנראה כבר אושר בעבר.');
}
const CUSTOMER_EMAIL = Session.getActiveUser().getEmail(); // נלקח אוטומטית מהמשתמש המחובר שמריץ את הסקריפט
const CUSTOMER_TOKEN = '<REDACTED>';
const LOG_SHEET_NAME = 'לוגי שיתוף';

/**
 * הפונקציה שקוראים לה בפועל כדי לשתף קובץ.
 */
function shareFileWithUser(recipientEmail, fileId, permission, messageText) {
  console.log('========================================');
  console.log('שלב 1: התחלת תהליך שיתוף קובץ (v4: DriveApp ישיר, ללא ShareLib)');
  console.log('מקבל השיתוף: ' + recipientEmail);
  console.log('מזהה תיקייה (fileId): ' + fileId);
  console.log('סוג הרשאה: ' + permission);
  console.log('הודעה מצורפת: ' + (messageText || '(ללא הודעה)'));

  // v4: ShareLib (ספרייה חיצונית) הוסרה משלב זה - נכשלה עקבית בהרצת Web App
  // (doGet/doPost) עם "You do not have permission to access the requested document",
  // כנראה עקב גישה פנימית שלה ל"מסמך פעיל" שלא קיים בהקשר כזה. אין לנו גישת עריכה
  // לספרייה, אז משתמשים ב-DriveApp הבסיסי ישירות (אותו API שכבר עובד בשלב ההעתקה).
  let result;
  try {
    const folder = DriveApp.getFolderById(fileId);
    if (permission === 'editor') {
      folder.addEditor(recipientEmail);
    } else {
      folder.addViewer(recipientEmail);
    }
    result = { success: true, message: 'השיתוף בוצע בהצלחה', requestId: Utilities.getUuid() };
    console.log('שלב 2: השיתוף בוצע בהצלחה.');
  } catch (err) {
    console.log('שלב 2: השיתוף נכשל: ' + err.message);
    result = { success: false, message: err.message, requestId: Utilities.getUuid() };
  }

  console.log('שלב 6: סיום תהליך שיתוף קובץ.');
  console.log('========================================');

  writeClientLog(
    timestamp,
    recipientEmail,
    fileId,
    permission,
    result && result.success,
    (result && result.message) || 'אין הודעה',
    (result && result.requestId) || ''
  );

  return result;
}

/**
 * דוגמת קריאה ידנית לבדיקה
 */
function _testShare() {
  console.log('--- הרצת בדיקה ידנית (_testShare) ---');
  try {
    const result = shareFileWithUser(
      'silver96744@gmail.com',
      '19AYootfFqbFVVZFW7piEM6IT73Dn5cHE',
      'viewer',
      'הקובץ שלך מוכן'
    );
    console.log('בדיקה הסתיימה. סטטוס סופי: ' + (result && result.success ? 'הצלחה' : 'כשלון'));
  } catch (err) {
    console.log('בדיקה נכשלה עם שגיאה בלתי צפויה: ' + err.message);
  }
}

function writeClientLog(timestamp, recipientEmail, fileId, permission, success, message, requestId) {
  try {
    var ss = _getBoundSpreadsheet();
    var sheet = ss.getSheetByName(LOG_SHEET_NAME);

    if (!sheet) {
      sheet = ss.insertSheet(LOG_SHEET_NAME);
      sheet.appendRow(['תאריך ושעה','מבצע השיתוף','מקבל השיתוף','מזהה קובץ','הרשאה','סטטוס','הודעה','מזהה בקשה (requestId)']);
      var headerRange = sheet.getRange(1, 1, 1, 8);
      headerRange.setFontWeight('bold');
      headerRange.setBackground('#4a86e8');
      headerRange.setFontColor('#ffffff');
      sheet.setFrozenRows(1);
    }

    sheet.appendRow([
      timestamp,
      CUSTOMER_EMAIL,
      recipientEmail,
      fileId,
      permission,
      success ? '✅ הצלחה' : '❌ כשלון',
      message,
      requestId || ''
    ]);
  } catch (err) {
    console.log('שגיאה בכתיבת לוג לגיליון: ' + err.message);
  }
}


/* ============================================================
 * חלק ב' - גרסה 2: וובהוק מימוש עם paymentType + requestType
 * ============================================================ */

const FULFILLMENT_LOG_SHEET_NAME = 'לוג בקשות מימוש';
const EVENT_LOG_SHEET_NAME = 'יומן אירועים מפורט';

// v2: שתי עמודות חדשות בסוף - paymentType, requestType
const FULFILLMENT_LOG_HEADERS = [
  'orderId',            // 1
  'requestId',          // 2
  'folderId',           // 3
  'folderUrl',          // 4
  'copyStatus',         // 5  PENDING | DONE | FAILED
  'shareStatus',        // 6  PENDING | DONE | FAILED
  'recipientEmail',     // 7
  'errorCode',          // 8
  'errorMessage',       // 9
  'itemResultsJson',    // 10
  'createdAt',          // 11
  'updatedAt',          // 12
  'paymentType',        // 13  v2
  'requestType'         // 14  v2
];

const EVENT_LOG_HEADERS = [
  'timestamp',     // 1
  'orderId',       // 2
  'requestId',     // 3
  'שלב',           // 4
  'סטטוס',         // 5
  'פרטים'          // 6
];

// v2: ערכי permission מותרים
const ALLOWED_PERMISSIONS = ['viewer', 'editor'];

// v3: רשימת ערכי paymentType מותרים - אכיפה קשיחה. ערך אחר יידחה.
const ALLOWED_PAYMENT_TYPES = ['CREDIT_CARD', 'BANK_TRANSFER', 'CASH', 'CALLBACK'];

// v3: אילו ערכי paymentType מפעילים שיתוף אוטומטי עם הלקוח (מסלול א').
// כל ערך מותר אחר -> מסלול ב': העתקה בלבד, בלי שיתוף (WAITING_MANUAL).
const AUTO_SHARE_PAYMENT_TYPES = ['CREDIT_CARD'];

// v2: אכיפת enum ל-requestType - כל עוד הרשימה ריקה, כל מחרוזת לא-ריקה מתקבלת.
const ALLOWED_REQUEST_TYPES = [];   // לדוגמה: ['STORY_SELECTION', 'ADULT_COLLECTION']

/**
 * נקודת הכניסה מהוובהוק החיצוני.
 */
function doPost(e) {
  return _handleFulfillmentRequest(e && e.postData && e.postData.contents);
}

// v4: doGet מקבל גם payload דרך query string (?payload=...) - עוקף חסימת POST אנונימי
// שנצפתה בחשבון הזה (Google מחזיר שגיאת Drive על כל POST, גם בפרויקט ריק לגמרי -
// אומת עם בדיקות מבודדות ב-13/7). GET עם query string עובד תקין.
function doGet(e) {
  if (e && e.parameter && e.parameter.payload) {
    return _handleFulfillmentRequest(e.parameter.payload);
  }
  return ContentService
    .createTextOutput("GET OK")
    .setMimeType(ContentService.MimeType.TEXT);
}

function _handleFulfillmentRequest(rawPayload) {
  console.log("doPost הגיע");

  const startTime = new Date();
  let orderId = '(לא ידוע)';
  let requestId = '(לא ידוע)';

  console.log('============================================================');
  console.log('doPost: התקבלה בקשה חדשה בשעה ' + startTime.toISOString());

  let payload;
  try {
    payload = JSON.parse(rawPayload);
  } catch (err) {
    console.log('שגיאה: לא ניתן היה לפרסר את גוף הבקשה כ-JSON. פרטים: ' + err.message);
    _logEvent('(לא ידוע)', '(לא ידוע)', 'קבלת בקשה', 'נכשל', 'JSON לא תקין: ' + err.message);
    return _jsonResponse(_errorResult('INVALID_PAYLOAD', 'לא ניתן היה לפרסר את גוף הבקשה כ-JSON'));
  }

  orderId = payload.orderId || '(חסר)';
  requestId = payload.requestId || Utilities.getUuid();
  const orderNumber = payload.orderNumber || '';

  console.log('orderId: ' + orderId + ' | requestId: ' + requestId);
  _logEvent(orderId, requestId, 'קבלת בקשה', 'התחיל', 'התקבל payload עם ' +
    ((payload.fileIds && payload.fileIds.length) || 0) + ' מזהי קבצים, נמען: ' + payload.recipientEmail +
    ', paymentType=' + payload.paymentType + ', requestType=' + payload.requestType);   // v2

  // שלב 1: אימות secret
  console.log('שלב 1: מאמתים סוד הזדהות (secret)...');
  const expectedSecret = PropertiesService.getScriptProperties().getProperty('FULFILLMENT_WEBHOOK_SECRET');
  if (!expectedSecret) {
    console.log('שגיאה קריטית: לא הוגדר FULFILLMENT_WEBHOOK_SECRET ב-Script Properties.');
    _logEvent(orderId, requestId, 'אימות secret', 'נכשל', 'לא הוגדר סוד במאפייני הסקריפט');
    return _jsonResponse(_errorResult('INVALID_SECRET', 'סוד הזדהות לא מוגדר בשרת'));
  }
  if (!_safeCompare(String(payload.secret || ''), expectedSecret)) {
    console.log('שגיאה: סוד ההזדהות שהתקבל אינו תואם.');
    _logEvent(orderId, requestId, 'אימות secret', 'נכשל', 'סוד שגוי התקבל בבקשה');
    return _jsonResponse(_errorResult('INVALID_SECRET', 'סוד הזדהות שגוי או חסר'));
  }
  console.log('שלב 1: הסוד אומת בהצלחה.');
  _logEvent(orderId, requestId, 'אימות secret', 'הצליח', '');

  // שלב 2: ולידציה של שדות חובה
  console.log('שלב 2: בודקים שדות חובה...');
  const fileIds = payload.fileIds;
  const recipientEmail = payload.recipientEmail;
  const permission = payload.permission || 'viewer';
  const message = payload.message || '';
  const paymentType = String(payload.paymentType || '');   // v2
  const requestType = String(payload.requestType || '');   // v2

  if (!payload.orderId || !Array.isArray(fileIds) || fileIds.length === 0 || !recipientEmail) {
    console.log('שגיאה: חסרים שדות חובה. orderId=' + payload.orderId + ', fileIds=' + JSON.stringify(fileIds) + ', recipientEmail=' + recipientEmail);
    _logEvent(orderId, requestId, 'ולידציה', 'נכשל', 'חסרים שדות חובה (orderId / fileIds / recipientEmail)');
    return _jsonResponse(_errorResult('MISSING_FIELDS', 'orderId, fileIds ו-recipientEmail הם שדות חובה'));
  }

  // v2: paymentType ו-requestType הם שדות חובה
  if (!paymentType || !requestType) {
    console.log('שגיאה: חסר paymentType או requestType. paymentType=' + paymentType + ', requestType=' + requestType);
    _logEvent(orderId, requestId, 'ולידציה', 'נכשל', 'חסר paymentType או requestType');
    return _jsonResponse(_errorResult('MISSING_FIELDS', 'paymentType ו-requestType הם שדות חובה'));
  }

  // v2: אכיפת enum רק אם הוגדרו רשימות מותרות
  if (ALLOWED_PAYMENT_TYPES.length > 0 && ALLOWED_PAYMENT_TYPES.indexOf(paymentType) === -1) {
    console.log('שגיאה: paymentType לא מוכר: ' + paymentType);
    _logEvent(orderId, requestId, 'ולידציה', 'נכשל', 'paymentType לא מוכר: ' + paymentType);
    return _jsonResponse(_errorResult('INVALID_PAYMENT_TYPE', 'paymentType לא מוכר: ' + paymentType));
  }
  if (ALLOWED_REQUEST_TYPES.length > 0 && ALLOWED_REQUEST_TYPES.indexOf(requestType) === -1) {
    console.log('שגיאה: requestType לא מוכר: ' + requestType);
    _logEvent(orderId, requestId, 'ולידציה', 'נכשל', 'requestType לא מוכר: ' + requestType);
    return _jsonResponse(_errorResult('INVALID_REQUEST_TYPE', 'requestType לא מוכר: ' + requestType));
  }

  // v2: permission חייב להיות viewer או editor
  if (ALLOWED_PERMISSIONS.indexOf(permission) === -1) {
    console.log('שגיאה: permission לא חוקי: ' + permission);
    _logEvent(orderId, requestId, 'ולידציה', 'נכשל', 'permission לא חוקי: ' + permission);
    return _jsonResponse(_errorResult('INVALID_PERMISSION', 'permission חייב להיות viewer או editor'));
  }

  console.log('שלב 2: כל השדות הנדרשים קיימים. מספר קבצים: ' + fileIds.length +
    ', paymentType=' + paymentType + ', requestType=' + requestType);
  _logEvent(orderId, requestId, 'ולידציה', 'הצליח', 'מספר קבצים: ' + fileIds.length + ', נמען: ' + recipientEmail +
    ', paymentType=' + paymentType + ', requestType=' + requestType);

  console.log('שלב 3: מנסים לנעול נעילה גלובלית (LockService)...');
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    console.log('שלב 3: הנעילה התקבלה.');
  } catch (err) {
    console.log('שגיאה: פג תוקף ההמתנה לנעילה.');
    _logEvent(orderId, requestId, 'נעילה', 'נכשל', 'timeout בהמתנה לנעילה - יתכן ובקשה מקבילה עדיין רצה');
    return _jsonResponse(_errorResult('LOCK_TIMEOUT', 'המערכת עסוקה, נסי שוב בעוד רגע'));
  }

  try {
    console.log('שלב 4: פותחים/יוצרים את גיליון הלוג הראשי...');
    const sheet = _getOrCreateFulfillmentLogSheet();

    // שלב 5: בדיקת idempotency
    console.log('שלב 5: בודקים אם ההזמנה כבר טופלה בעבר (orderId=' + orderId + ')...');
    let logRow = _findLogRowByOrderId(sheet, orderId);

    if (logRow) {
      console.log('נמצאה שורה קיימת. copyStatus=' + logRow.data.copyStatus + ', shareStatus=' + logRow.data.shareStatus);
    } else {
      console.log('לא נמצאה שורה קיימת - זו בקשה חדשה.');
    }

    // v3: גם WAITING_MANUAL נחשב מצב סופי - המשרד משתף ידנית, הסקריפט לא נוגע שוב
    if (logRow && logRow.data.copyStatus === 'DONE' &&
        (logRow.data.shareStatus === 'DONE' || logRow.data.shareStatus === 'WAITING_MANUAL')) {
      console.log('ההזמנה כבר טופלה בעבר (shareStatus=' + logRow.data.shareStatus + '). מחזירים תוצאה קיימת.');
      _logEvent(orderId, requestId, 'בדיקת idempotency', 'מידע',
        'ההזמנה כבר טופלה (shareStatus=' + logRow.data.shareStatus + ') - אין פעולה נוספת');
      const result = _buildResultFromLogRow(logRow.data);
      result.alreadyProcessed = true;
      return _jsonResponse(result);
    }

    let folderId, folderUrl, itemResults;

    if (logRow && logRow.data.copyStatus === 'DONE') {
      console.log('שלב 6: ההעתקה כבר בוצעה בעבר (folderId=' + logRow.data.folderId + '). מדלגים על העתקה.');
      _logEvent(orderId, requestId, 'העתקת קבצים', 'מידע', 'דילוג - כבר בוצע בעבר, folderId=' + logRow.data.folderId);
      folderId = logRow.data.folderId;
      folderUrl = logRow.data.folderUrl;
      itemResults = JSON.parse(logRow.data.itemResultsJson || '[]');
    } else {
      console.log('שלב 6: מתחילים יצירת תיקייה והעתקת ' + fileIds.length + ' קבצים...');
      _logEvent(orderId, requestId, 'העתקת קבצים', 'התחיל', 'יוצרים תיקייה ומעתיקים ' + fileIds.length + ' קבצים');

      const copyResult = copyFilesToNewFolder(orderId, orderNumber, fileIds, requestId);
      folderId = copyResult.folderId;
      folderUrl = copyResult.folderUrl;
      itemResults = copyResult.itemResults;

      const copyStatus = copyResult.anySuccess ? 'DONE' : 'FAILED';
      const successCount = itemResults.filter(function (r) { return r.copied; }).length;
      const failCount = itemResults.length - successCount;

      console.log('שלב 6: סיום העתקה. הצליחו: ' + successCount + ', נכשלו: ' + failCount + ', folderId=' + folderId);
      _logEvent(orderId, requestId, 'העתקת קבצים', copyResult.anySuccess ? 'הצליח' : 'נכשל',
        'הצליחו ' + successCount + ' מתוך ' + itemResults.length + ' קבצים. folderId=' + folderId);

      logRow = _upsertLogRow(sheet, logRow, {
        orderId: orderId,
        requestId: requestId,
        folderId: folderId,
        folderUrl: folderUrl,
        copyStatus: copyStatus,
        shareStatus: 'PENDING',
        recipientEmail: recipientEmail,
        errorCode: copyResult.anySuccess ? '' : 'COPY_FAILED',
        errorMessage: copyResult.anySuccess ? '' : 'כל העתקות הקבצים נכשלו',
        itemResultsJson: JSON.stringify(itemResults),
        paymentType: paymentType,     // v2
        requestType: requestType      // v2
      });
      console.log('שלב 6: שורת הלוג עודכנה.');

      if (!copyResult.anySuccess) {
        console.log('שגיאה: כל העתקות הקבצים נכשלו. עוצרים.');
        _logEvent(orderId, requestId, 'תהליך מימוש', 'נכשל', 'כל הקבצים נכשלו בהעתקה - התהליך נעצר');
        return _jsonResponse(_errorResult('COPY_FAILED', 'כל העתקות הקבצים נכשלו', itemResults));
      }
    }

    // שלב 7 (v3): בחירת מסלול לפי paymentType
    const isAutoShare = AUTO_SHARE_PAYMENT_TYPES.indexOf(paymentType) !== -1;
    console.log('שלב 7: בחירת מסלול. paymentType=' + paymentType + ' -> ' +
      (isAutoShare ? 'מסלול א\' - שיתוף אוטומטי עם הלקוח' : 'מסלול ב\' - העתקה בלבד, ממתין לשיתוף ידני'));
    _logEvent(orderId, requestId, 'בחירת מסלול', 'מידע',
      'paymentType=' + paymentType + ' -> ' +
      (isAutoShare ? 'שיתוף אוטומטי עם הלקוח' : 'ללא שיתוף - ממתין לשיתוף ידני של המשרד'));

    if (!isAutoShare) {
      // v3: מסלול ב' - לא משתפים. מעדכנים סטטוס ומחזירים תשובה מלאה לאתר.
      console.log('שלב 7: מדלגים על השיתוף. התיקייה נוצרה והקבצים הועתקו, השיתוף יבוצע ידנית ע"י המשרד.');
      _logEvent(orderId, requestId, 'שיתוף תיקייה', 'מידע',
        'דילוג על שיתוף - ממתין לשיתוף ידני. folderId=' + folderId + ', לקוח=' + recipientEmail);

      _upsertLogRow(sheet, logRow, {
        shareStatus: 'WAITING_MANUAL',
        errorCode: '',
        errorMessage: ''
      });

      const totalSecondsManual = (new Date() - startTime) / 1000;
      console.log('שלב 8: סיום (מסלול ידני). משך כולל: ' + totalSecondsManual + ' שניות.');
      _logEvent(orderId, requestId, 'תהליך מימוש', 'הצליח',
        'הושלם במסלול ידני (ללא שיתוף) תוך ' + totalSecondsManual + ' שניות');
      console.log('============================================================');

      return _jsonResponse({
        success: true,
        requestStatus: 'COMPLETED',
        sharingStatus: 'WAITING_MANUAL',
        externalFolderId: folderId,
        externalFolderUrl: folderUrl,
        sharedEmail: recipientEmail,   // מייל הלקוח - כדי שהאתר יעביר למשרד לשיתוף ידני
        errorCode: null,
        errorMessage: null,
        itemResults: itemResults,
        alreadyProcessed: false,
        paymentType: paymentType,
        requestType: requestType
      });
    }

    // מסלול א' (v3): שיתוף אוטומטי - כמו קודם
    console.log('שלב 7: קוראים ל-shareFileWithUser עם folderId=' + folderId + ', recipientEmail=' + recipientEmail + '...');
    _logEvent(orderId, requestId, 'שיתוף תיקייה', 'התחיל', 'folderId=' + folderId + ', נמען=' + recipientEmail);

    let shareResult;
    try {
      shareResult = shareFileWithUser(recipientEmail, folderId, permission, message);
      console.log('שלב 7: התקבלה תשובה מ-shareFileWithUser: ' + JSON.stringify(shareResult));
    } catch (err) {
      console.log('שגיאה: הקריאה ל-shareFileWithUser נכשלה. פרטים: ' + err.message);
      _logEvent(orderId, requestId, 'שיתוף תיקייה', 'נכשל', 'חריגה בקריאה לפונקציית השיתוף: ' + err.message);
      _upsertLogRow(sheet, logRow, {
        shareStatus: 'FAILED',
        errorCode: 'SHARE_CALL_FAILED',
        errorMessage: err.message
      });
      return _jsonResponse(_errorResult('SHARE_CALL_FAILED', err.message, itemResults, folderId, folderUrl));
    }

    const shareSuccess = shareResult && shareResult.success === true;
    console.log('שלב 7: תוצאת השיתוף: ' + (shareSuccess ? 'הצלחה' : 'כשלון'));
    _logEvent(orderId, requestId, 'שיתוף תיקייה', shareSuccess ? 'הצליח' : 'נכשל',
      (shareResult && shareResult.message) || '');

    _upsertLogRow(sheet, logRow, {
      shareStatus: shareSuccess ? 'DONE' : 'FAILED',
      errorCode: shareSuccess ? '' : 'SHARE_FAILED',
      errorMessage: shareSuccess ? '' : ((shareResult && shareResult.message) || 'שיתוף נכשל')
    });

    const totalSeconds = (new Date() - startTime) / 1000;
    console.log('שלב 8: סיום. משך כולל: ' + totalSeconds + ' שניות. הצלחה כוללת: ' + shareSuccess);
    _logEvent(orderId, requestId, 'תהליך מימוש', shareSuccess ? 'הצליח' : 'נכשל',
      'הושלם תוך ' + totalSeconds + ' שניות');
    console.log('============================================================');

    return _jsonResponse({
      success: shareSuccess,
      requestStatus: shareSuccess ? 'COMPLETED' : 'FAILED',
      sharingStatus: shareSuccess ? 'SHARED' : 'FAILED',
      externalFolderId: folderId,
      externalFolderUrl: folderUrl,
      sharedEmail: recipientEmail,
      errorCode: shareSuccess ? null : 'SHARE_FAILED',
      errorMessage: shareSuccess ? null : ((shareResult && shareResult.message) || 'שיתוף נכשל'),
      itemResults: itemResults,
      alreadyProcessed: false,
      paymentType: paymentType,     // v2
      requestType: requestType      // v2
    });

  } catch (err) {
    console.log('שגיאה כללית בלתי צפויה: ' + err.message);
    _logEvent(orderId, requestId, 'תהליך מימוש', 'נכשל', 'שגיאה בלתי צפויה: ' + err.message);
    return _jsonResponse(_errorResult('UNEXPECTED_ERROR', err.message));
  } finally {
    lock.releaseLock();
    console.log('הנעילה שוחררה.');
  }
}

const ROOT_FOLDER_NAME = 'שיתוף קבצים אוטומציה';

/**
 * מחזירה את תיקיית-האב הקבועה לכל תיקיות ההזמנות, ויוצרת אותה פעם אחת בלבד אם
 * אינה קיימת. ה-ID נשמר ב-Script Properties כדי לא לחפש/ליצור אותה מחדש בכל קריאה.
 */
function _getOrCreateRootFolder() {
  const cachedId = PropertiesService.getScriptProperties().getProperty('ROOT_FOLDER_ID');
  if (cachedId) {
    try {
      return DriveApp.getFolderById(cachedId);
    } catch (err) {
      console.log('_getOrCreateRootFolder: ה-ID השמור (' + cachedId + ') לא תקין יותר, מחפשים/יוצרים מחדש: ' + err.message);
    }
  }
  const existing = DriveApp.getRootFolder().getFoldersByName(ROOT_FOLDER_NAME);
  let folder;
  if (existing.hasNext()) {
    folder = existing.next();
    console.log('_getOrCreateRootFolder: נמצאה תיקיית-אב קיימת, folderId=' + folder.getId());
  } else {
    folder = DriveApp.getRootFolder().createFolder(ROOT_FOLDER_NAME);
    console.log('_getOrCreateRootFolder: נוצרה תיקיית-אב חדשה, folderId=' + folder.getId());
  }
  PropertiesService.getScriptProperties().setProperty('ROOT_FOLDER_ID', folder.getId());
  return folder;
}

/**
 * יוצרת תיקייה חדשה ומעתיקה אליה את כל הקבצים.
 */
function copyFilesToNewFolder(orderId, orderNumber, fileIds, requestId) {
  const folderName = 'יד תמר - ' + (orderNumber || orderId);
  console.log('copyFilesToNewFolder: יוצרים תיקייה בשם "' + folderName + '"...');

  let folder;
  try {
    const rootFolder = _getOrCreateRootFolder();
    folder = rootFolder.createFolder(folderName);
    console.log('copyFilesToNewFolder: התיקייה נוצרה. folderId=' + folder.getId());
  } catch (err) {
    console.log('copyFilesToNewFolder: שגיאה ביצירת התיקייה: ' + err.message);
    _logEvent(orderId, requestId, 'יצירת תיקייה', 'נכשל', err.message);
    throw new Error('FOLDER_CREATE_FAILED: ' + err.message);
  }
  _logEvent(orderId, requestId, 'יצירת תיקייה', 'הצליח', 'folderId=' + folder.getId() + ', שם=' + folderName);

  const itemResults = [];
  let anySuccess = false;

  fileIds.forEach(function (fileId, index) {
    console.log('copyFilesToNewFolder: מעתיקים קובץ ' + (index + 1) + '/' + fileIds.length + ' (fileId=' + fileId + ')...');
    try {
      const original = DriveApp.getFileById(fileId);
      const originalName = original.getName();
      original.makeCopy(originalName, folder);
      console.log('copyFilesToNewFolder: הקובץ "' + originalName + '" הועתק בהצלחה.');
      itemResults.push({ fileId: fileId, copied: true });
      anySuccess = true;
    } catch (err) {
      console.log('copyFilesToNewFolder: שגיאה בהעתקת קובץ fileId=' + fileId + ': ' + err.message);
      _logEvent(orderId, requestId, 'העתקת קובץ בודד', 'נכשל', 'fileId=' + fileId + ': ' + err.message);
      itemResults.push({ fileId: fileId, copied: false, error: 'COPY_FAILED: ' + err.message });
    }
  });

  console.log('copyFilesToNewFolder: סיום. סה"כ הצליחו ' +
    itemResults.filter(function (r) { return r.copied; }).length + ' מתוך ' + fileIds.length);

  return {
    folderId: folder.getId(),
    folderUrl: folder.getUrl(),
    itemResults: itemResults,
    anySuccess: anySuccess
  };
}

// ---------- פונקציות עזר לניהול גיליון הסטטוס ----------

function _getOrCreateFulfillmentLogSheet() {
  const ss = _getBoundSpreadsheet();
  let sheet = ss.getSheetByName(FULFILLMENT_LOG_SHEET_NAME);
  if (!sheet) {
    console.log('_getOrCreateFulfillmentLogSheet: הגיליון לא קיים, יוצרים אותו...');
    sheet = ss.insertSheet(FULFILLMENT_LOG_SHEET_NAME);
    sheet.appendRow(FULFILLMENT_LOG_HEADERS);
    const headerRange = sheet.getRange(1, 1, 1, FULFILLMENT_LOG_HEADERS.length);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#4a86e8');
    headerRange.setFontColor('#ffffff');
    sheet.setFrozenRows(1);
    console.log('_getOrCreateFulfillmentLogSheet: הגיליון נוצר עם כותרות.');
  }
  return sheet;
}

function _findLogRowByOrderId(sheet, orderId) {
  const finder = sheet.createTextFinder(orderId).matchEntireCell(true);
  const cell = finder.findNext();
  if (!cell) return null;

  const rowNum = cell.getRow();
  const rowValues = sheet.getRange(rowNum, 1, 1, FULFILLMENT_LOG_HEADERS.length).getValues()[0];
  const data = {};
  FULFILLMENT_LOG_HEADERS.forEach(function (header, i) {
    data[header] = rowValues[i];
  });
  return { rowNum: rowNum, data: data };
}

function _upsertLogRow(sheet, existingLogRow, fields) {
  const now = new Date();
  fields.updatedAt = now;

  if (existingLogRow) {
    const merged = Object.assign({}, existingLogRow.data, fields);
    const rowValues = FULFILLMENT_LOG_HEADERS.map(function (h) { return merged[h] !== undefined ? merged[h] : ''; });
    sheet.getRange(existingLogRow.rowNum, 1, 1, FULFILLMENT_LOG_HEADERS.length).setValues([rowValues]);
    return { rowNum: existingLogRow.rowNum, data: merged };
  } else {
    fields.createdAt = now;
    const rowValues = FULFILLMENT_LOG_HEADERS.map(function (h) { return fields[h] !== undefined ? fields[h] : ''; });
    sheet.appendRow(rowValues);
    const rowNum = sheet.getLastRow();
    return { rowNum: rowNum, data: fields };
  }
}

// ---------- פונקציית לוג אירועים ----------

function _logEvent(orderId, requestId, stage, status, details) {
  try {
    const ss = _getBoundSpreadsheet();
    let sheet = ss.getSheetByName(EVENT_LOG_SHEET_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(EVENT_LOG_SHEET_NAME);
      sheet.appendRow(EVENT_LOG_HEADERS);
      const headerRange = sheet.getRange(1, 1, 1, EVENT_LOG_HEADERS.length);
      headerRange.setFontWeight('bold');
      headerRange.setBackground('#6aa84f');
      headerRange.setFontColor('#ffffff');
      sheet.setFrozenRows(1);
    }
    sheet.appendRow([new Date(), orderId, requestId, stage, status, details || '']);
  } catch (err) {
    console.log('_logEvent: כשל בכתיבת אירוע ליומן (לא עוצר את התהליך): ' + err.message);
  }
}

// ---------- פונקציות עזר כלליות ----------

function _buildResultFromLogRow(data) {
  // v3: גם WAITING_MANUAL נחשב הצלחה - התהליך בצד הסקריפט הושלם
  const isCompleted = data.copyStatus === 'DONE' &&
    (data.shareStatus === 'DONE' || data.shareStatus === 'WAITING_MANUAL');
  return {
    success: isCompleted,
    requestStatus: isCompleted ? 'COMPLETED' : 'FAILED',
    sharingStatus: data.shareStatus,
    externalFolderId: data.folderId,
    externalFolderUrl: data.folderUrl,
    sharedEmail: data.recipientEmail,
    errorCode: data.errorCode || null,
    errorMessage: data.errorMessage || null,
    itemResults: JSON.parse(data.itemResultsJson || '[]'),
    paymentType: data.paymentType || null,   // v2
    requestType: data.requestType || null    // v2
  };
}

function _errorResult(errorCode, errorMessage, itemResults, folderId, folderUrl) {
  return {
    success: false,
    requestStatus: 'FAILED',
    sharingStatus: 'FAILED',
    externalFolderId: folderId || null,
    externalFolderUrl: folderUrl || null,
    sharedEmail: null,
    errorCode: errorCode,
    errorMessage: errorMessage,
    itemResults: itemResults || [],
    alreadyProcessed: false
  };
}

function _jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function _safeCompare(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

// ---------- פונקציית בדיקה ידנית ----------

/**
 * בדיקה ידנית מהעורך - מדמה בקשת webhook מלאה כולל השדות החדשים.
 * v3: הסוד נקרא מ-Script Properties ולא כתוב בקוד - כך הבדיקה
 * מוודאת שה-FULFILLMENT_WEBHOOK_SECRET באמת מוגדר ותקף.
 */
function _testDoPost() {
  console.log('_testDoPost: מתחילים בדיקה ידנית...');

  const secret = PropertiesService.getScriptProperties().getProperty('FULFILLMENT_WEBHOOK_SECRET');
  if (!secret) {
    console.log('_testDoPost: שגיאה - FULFILLMENT_WEBHOOK_SECRET לא מוגדר ב-Script Properties. הגדירי אותו לפני הבדיקה.');
    return;
  }

  const testPayload = {
    secret: secret,
    orderId: 'TEST-' + new Date().getTime(),
    requestId: Utilities.getUuid(),
    fileIds: [
      '1eIzGkWAAOJEwNeYMDGtWaWEZI3R0ZGDQ',
      '1JyXMNCmFuTcv_0wJG6eQ5IAmc0BU19XL',
      '199sB9EIrRnAeYsVx4ZaPDVDdbaMKiQqH',
      '1nX8KZGhxXO5dbH6rQutnVDx17onsmQkr',
      '14QkqJZLAmHN_3aB8f633ra1ddJ7kBavF'
    ],
    recipientEmail: 'silver.chaya@gmail.com',
    permission: 'editor',                 // v2: כמו שהמערכת השולחת תשלח
    paymentType: 'CREDIT_CARD',           // v2
    requestType: 'STORY_SELECTION',       // v2
    message: 'זו הודעת בדיקה מהסקריפט'
  };

  console.log('_testDoPost: payload לבדיקה: ' + JSON.stringify(testPayload));

  const fakeEvent = {
    postData: {
      contents: JSON.stringify(testPayload)
    }
  };

  const result = doPost(fakeEvent);
  console.log('_testDoPost: תוצאת הבדיקה המלאה:');
  console.log(result.getContent());
}

/**
 * v3: בדיקת מסלול ב' - העברה בנקאית. מצופה: success=true,
 * sharingStatus="WAITING_MANUAL", תיקייה נוצרת, אין שיתוף בפועל.
 */
function _testDoPostManualRoute() {
  console.log('_testDoPostManualRoute: בדיקת מסלול ידני (BANK_TRANSFER)...');

  const secret = PropertiesService.getScriptProperties().getProperty('FULFILLMENT_WEBHOOK_SECRET');
  if (!secret) {
    console.log('_testDoPostManualRoute: שגיאה - FULFILLMENT_WEBHOOK_SECRET לא מוגדר.');
    return;
  }

  const testPayload = {
    secret: secret,
    orderId: 'TEST-MANUAL-' + new Date().getTime(),
    requestId: Utilities.getUuid(),
    fileIds: [
      '1eIzGkWAAOJEwNeYMDGtWaWEZI3R0ZGDQ'
    ],
    recipientEmail: 'silver.chaya@gmail.com',
    permission: 'editor',
    paymentType: 'BANK_TRANSFER',
    requestType: 'STORY_SELECTION'
  };

  const result = doPost({ postData: { contents: JSON.stringify(testPayload) } });
  console.log('_testDoPostManualRoute: תוצאה: ' + result.getContent());
}

/**
 * v3: בדיקה שלילית - סוד שגוי. מצופה: success=false, errorCode="INVALID_SECRET",
 * ולא נוצרת שום תיקייה. אם הבדיקה הזו "מצליחה" לשתף - יש בעיה חמורה.
 */
function _testDoPostWrongSecret() {
  console.log('_testDoPostWrongSecret: בדיקת דחייה עם סוד שגוי...');

  const testPayload = {
    secret: 'WRONG-SECRET-123',
    orderId: 'TEST-BADSECRET-' + new Date().getTime(),
    requestId: Utilities.getUuid(),
    fileIds: ['1eIzGkWAAOJEwNeYMDGtWaWEZI3R0ZGDQ'],
    recipientEmail: 'silver.chaya@gmail.com',
    permission: 'editor',
    paymentType: 'CREDIT_CARD',
    requestType: 'STORY_SELECTION'
  };

  const result = doPost({ postData: { contents: JSON.stringify(testPayload) } });
  const parsed = JSON.parse(result.getContent());
  console.log('_testDoPostWrongSecret: תוצאה: ' + result.getContent());
  console.log(parsed.errorCode === 'INVALID_SECRET'
    ? '_testDoPostWrongSecret: תקין - הבקשה נדחתה כמצופה.'
    : '_testDoPostWrongSecret: בעיה! הבקשה לא נדחתה למרות סוד שגוי.');
}
/**
 * בדיקת BANK_TRANSFER עם קובץ תקין.
 * מצופה: success=true, sharingStatus="WAITING_MANUAL",
 * נוצרת תיקייה עם הקובץ - ובלי שום שיתוף עליה.
 */
function _testBankTransferValidFile() {
  console.log('_testBankTransferValidFile: בדיקת העברה בנקאית עם קובץ תקין...');

  const secret = PropertiesService.getScriptProperties().getProperty('FULFILLMENT_WEBHOOK_SECRET');
  if (!secret) {
    console.log('שגיאה: FULFILLMENT_WEBHOOK_SECRET לא מוגדר ב-Script Properties.');
    return;
  }

  const testPayload = {
    secret: secret,
    orderId: 'TEST-BANK-OK-' + new Date().getTime(),
    requestId: Utilities.getUuid(),
    fileIds: ['1pY8TK1bQB_eQqajgj16w1vVfkS4EzlHr'],
    recipientEmail: 'silver.chaya@gmail.com',
    permission: 'editor',
    paymentType: 'BANK_TRANSFER',
    requestType: 'STORY_SELECTION'
  };

  const result = doPost({ postData: { contents: JSON.stringify(testPayload) } });
  const parsed = JSON.parse(result.getContent());
  console.log('תוצאה מלאה: ' + result.getContent());
  console.log(parsed.success === true && parsed.sharingStatus === 'WAITING_MANUAL'
    ? '✅ תקין: התיקייה נוצרה בלי שיתוף (WAITING_MANUAL). בדקי בדרייב שאין הרשאות על התיקייה.'
    : '❌ בעיה: התוצאה לא תואמת את המצופה (success=true + WAITING_MANUAL).');
}

/**
 * בדיקת BANK_TRANSFER עם קובץ שגוי (מזהה לא קיים).
 * מצופה: success=false, errorCode="COPY_FAILED", בלי שיתוף.
 */
function _testBankTransferBadFile() {
  console.log('_testBankTransferBadFile: בדיקת העברה בנקאית עם מזהה קובץ שגוי...');

  const secret = PropertiesService.getScriptProperties().getProperty('FULFILLMENT_WEBHOOK_SECRET');
  if (!secret) {
    console.log('שגיאה: FULFILLMENT_WEBHOOK_SECRET לא מוגדר ב-Script Properties.');
    return;
  }

  const testPayload = {
    secret: secret,
    orderId: 'TEST-BANK-BAD-' + new Date().getTime(),
    requestId: Utilities.getUuid(),
    fileIds: ['0000-FILE-ID-LO-KAYAM-0000'],
    recipientEmail: 'silver.chaya@gmail.com',
    permission: 'editor',
    paymentType: 'BANK_TRANSFER',
    requestType: 'STORY_SELECTION'
  };

  const result = doPost({ postData: { contents: JSON.stringify(testPayload) } });
  const parsed = JSON.parse(result.getContent());
  console.log('תוצאה מלאה: ' + result.getContent());
  console.log(parsed.success === false && parsed.errorCode === 'COPY_FAILED'
    ? '✅ תקין: הבקשה נכשלה כמצופה (COPY_FAILED) ולא בוצע שיתוף.'
    : '❌ בעיה: ציפינו ל-COPY_FAILED וקיבלנו משהו אחר.');
}