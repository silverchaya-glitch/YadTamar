/**
 * ============================================================
 *  עותק-ייחוס (reference copy) — לא מורץ ע"י שרת ה-Node
 * ============================================================
 *  עדכון 2026-07-13: הקוד פרוס בפועל תחת חשבון yadtamar613@gmail.com (לא
 *  silver.chaya@gmail.com) — פרויקט Apps Script עצמאי ("YadTamar-ShareLib",
 *  scriptId 1sf1LDC0eaSm67nlE633-GJqwxUCs59Ck-9Q1RNBiBXAYsDXITeZnkh9b),
 *  לפי בקשה מפורשת שהכל יעבור דרך חשבון yadtamar613 בלבד. הקוד עצמו זהה
 *  לעותק ההתייחסות ש-silver.chaya מסרה במקור (אותו contract/doGet), מלבד
 *  שני שינויים נדרשים כדי לרוץ תחת חשבון אחר: LOG_SPREADSHEET_ID מצביע
 *  לגיליון חדש בבעלות yadtamar613 (הישן היה בבעלות silver.chaya ולא
 *  נגיש — גרם לקריסה לא-נתפסת), ו-Script Properties (ALERT_OWNER_EMAIL/
 *  ADMIN_EMAIL) מוגדרים ל-silver.chaya@gmail.com (יעד ההתראות, לא הבעלים).
 *  שינוי בקובץ הזה בריפו לא משפיע על הפריסה בפועל — יש לדחוף/לפרוס דרך
 *  clasp (ראה PROGRESS.txt 2026-07-13) תחת חשבון yadtamar613.
 *
 *  עדכון 2026-07-21: הוסרה שליחת המייל ללקוח מתוך הסקריפט (sendShareNotificationEmail
 *  ותלוייה buildEmailSubject/buildShareEmailHtml נמחקו) — האתר (server/services/email.js,
 *  sendFileDelivery) שולח את מייל הקישור ללקוח במקום זאת, עם הפרפיקס/שם השולח הקבועים
 *  של האתר. השיתוף בדרייב עצמו (addViewer/addEditor) לא שונה.
 *
 *  Script Properties נדרשים (Project Settings -> Script Properties):
 *    ALERT_OWNER_EMAIL  - silver.chaya@gmail.com, לקבלת התרעות על ניסיונות לא מורשים
 *    ADMIN_EMAIL        - silver.chaya@gmail.com, לקבלת התרעות על קריסות מערכת כלליות
 * ============================================================
 */

function _verifyToken() {
  Logger.log(generateToken('silver.chaya@gmail.com')); // המייל המדויק מ-SHARE_CUSTOMER_EMAIL ב-.env
}

function logSpreadsheetUrl() {
    const ss = SpreadsheetApp.openById(LOG_SPREADSHEET_ID);
  if (!ss) {
    Logger.log('אין Spreadsheet מקושר לסקריפט הזה');
    return;
  }
  Logger.log('כתובת ה-Google Sheet המקושר: ' + ss.getUrl());
}

/**
 * ============================================================
 *  אפליקציית שיתוף קבצים בדרייב - קוד שרת (יושב אצלך, Owner)
 * ============================================================
 *
 *  מודל: Webhook יחיד (URL אחד) שכל הלקוחות (יד תמר, דן וכו') קוראים אליו.
 *  הקוד תמיד רץ תחת חשבון Google שלך - את בעלת ה-Spreadsheet/Gmail כאן.
 *
 *  Script Properties נדרשים (Project Settings -> Script Properties):
 *    ALERT_OWNER_EMAIL  - כתובת המייל שלך, לקבלת התרעות על ניסיונות לא מורשים
 *    ADMIN_EMAIL        - כתובת המייל שלך, לקבלת התרעות על קריסות מערכת כלליות
 *                         (יכולה להיות זהה ל-ALERT_OWNER_EMAIL אם זה אותו אדם)
 * ============================================================
 */

const LOG_SHEET_NAME = 'לוגים';
const LOG_SPREADSHEET_ID = '10DPq9digOdHIsDcqnE41x2a0-OOV8eePMPqp7NmVT7U'; // YadTamar-ShareLib-Logs, בבעלות yadtamar613@gmail.com

const VERBOSE_LOGGING_ENABLED = true; // דגל יחיד, בשליטתך בלבד - הלקוח לא יכול להשפיע עליו
const SECRET = "chayasilver_"; // סוד קבוע בצד שרת בלבד - לעולם לא נמסר ללקוח
const SCRIPT_VERSION_TAG = 'v-2026-06-30-logs-2';
const SCRIPT_EDITOR_URL = 'https://script.google.com/d/1sf1LDC0eaSm67nlE633-GJqwxUCs59Ck-9Q1RNBiBXAYsDXITeZnkh9b/edit';

function doGet(e) {
  const requestId = Utilities.getUuid();
  const debugLog = [];

  // משתנים שצריכים להיות זמינים גם בתוך ה-catch החיצוני
  let emailFrom = '';
  let recipientEmail = '';
  let fileId = '';
  let permission = '';
  let fileName = '';
  let fileUrl = '';
  let customerSheetId = '';

  try {
    logInfo(debugLog, 'בקשה התקבלה');

    const rawParams = (e && e.parameter) ? e.parameter : {};
    const params = normalizeParameterKeys(rawParams);
    logVerbose(debugLog, 'פרמטרים גולמיים שהתקבלו: ' + JSON.stringify(params));

    // === שכבת אימות (per-customer token) ===
    emailFrom = (params.email_from || '').trim();
    const customerToken = (params.token || '').trim();

    logInfo(debugLog, 'מתבצע אימות זהות הלקוח הקורא');
    logVerbose(debugLog, 'email_from שהתקבל: ' + emailFrom);
    logVerbose(debugLog, 'token שהתקבל: ' + customerToken);

    const authResult = authenticateRequest(requestId, emailFrom, customerToken, debugLog);

    if (!authResult.authorized) {
      logVerbose(debugLog, 'אימות נכשל - הבקשה נחסמת, לא נכתבת שורת Sheet, נשלחה התרעה לבעלת המערכת בלבד');
      return jsonResponse(requestId, false, 'הבקשה נחסמה: אין הרשאה להשתמש בשירות זה', debugLog);
    }

    logInfo(debugLog, 'אימות עבר בהצלחה');

    // בדיקת תקינות פורמט email_from - קריטי כי הוא ישמש כיעד למיילי כשל בהמשך.
    // טוקן תקין לא בהכרח אומר שה-email_from נשלח כפורמט מייל חוקי (יכול היה
    // להיות מורכב מ-URL encoding שגוי וכדומה).
    if (!isValidEmail(emailFrom)) {
      logVerbose(debugLog, 'email_from אינו בפורמט מייל תקין, לא יישלחו אליו התרעות כשל');
    }
    // === סוף שכבת אימות ===

    recipientEmail = (params.recipientemail || '').trim();
    fileId = (params.fileid || '').trim();
    permission = (params.permission || '').trim().toLowerCase();
    const messageText = params.messagetext || '';
    // מזהה Google Sheet של הלקוח - אופציונלי. אם סופק, כל שורת לוג של הבקשה הזו
    // תיכתב גם אליו (בנוסף ללוג הפנימי), best-effort.
    customerSheetId = (params.sheetid || '').trim();

    logVerbose(debugLog, 'recipientEmail (נמען השיתוף בפועל): ' + recipientEmail);
    logVerbose(debugLog, 'fileId: [' + fileId + ']');
    logVerbose(debugLog, 'permission: ' + permission);
    logVerbose(debugLog, 'messageText סופק: ' + (messageText ? 'כן (' + messageText.length + ' תווים)' : 'לא - ייעשה שימוש בברירת מחדל'));
    logVerbose(debugLog, 'sheetId (גליון לוג של הלקוח) סופק: ' + (customerSheetId ? customerSheetId : 'לא'));

    if (!recipientEmail) {
      return fail(requestId, debugLog, emailFrom, recipientEmail, fileId, permission, 'לא הצלחנו למצוא את כתובת המייל של מקבל השיתוף', 'חסר פרמטר recipientEmail', customerSheetId);
    }

    if (!isValidEmail(recipientEmail)) {
      return fail(requestId, debugLog, emailFrom, recipientEmail, fileId, permission, 'כתובת המייל של מקבל השיתוף אינה תקינה', 'כתובת מייל לא תקינה: ' + recipientEmail, customerSheetId);
    }

    if (!fileId) {
      return fail(requestId, debugLog, emailFrom, recipientEmail, fileId, permission, 'מזהה הקובץ חסר או אינו תקין', 'חסר פרמטר fileId', customerSheetId);
    }

    if (!['viewer', 'editor'].includes(permission)) {
      return fail(requestId, debugLog, emailFrom, recipientEmail, fileId, permission, 'סוג ההרשאה אינו תקין', 'permission לא תקין: ' + permission, customerSheetId);
    }

    logInfo(debugLog, 'ולידציה תקינה - כל הפרמטרים תקינים');

    let file;

    try {
      logVerbose(debugLog, 'שלב 1 - לפני קריאה ל-getFileById');
      file = DriveApp.getFileById(fileId);
      logVerbose(debugLog, 'שלב 2 - נמצא אובייקט קובץ בדרייב');

      fileName = file.getName();
      logVerbose(debugLog, 'שלב 3 - שם הקובץ: ' + fileName);

      fileUrl = file.getUrl();
      logVerbose(debugLog, 'שלב 4 - קישור הקובץ: ' + fileUrl);

    } catch (err) {
      logVerbose(debugLog, 'CRASH LOCATION (אחזור קובץ): ' + (err.stack || err.message));

      return fail(
        requestId, debugLog, emailFrom, recipientEmail, fileId, permission,
        'הקובץ שביקשת כרגע אינו זמין או שהקישור אינו תקין.',
        'קובץ לא נמצא / אין הרשאה לקובץ. ',
        customerSheetId
      );
    }

    if (!fileUrl || !isValidHttpUrl(fileUrl)) {
      return fail(
        requestId, debugLog, emailFrom, recipientEmail, fileId, permission,
        'קישור הקובץ אינו תקין. צוות התמיכה עודכן.',
        'URL לא תקין לקובץ: ' + fileUrl,
        customerSheetId
      );
    }

    logInfo(debugLog, 'קובץ אותר בהצלחה: ' + fileName);

    try {
      logVerbose(debugLog, 'לפני ביצוע שיתוף בדרייב');

      if (permission === 'viewer') {
        file.addViewer(recipientEmail);
        logVerbose(debugLog, 'נוספה הרשאת צפייה (viewer)');
      } else {
        file.addEditor(recipientEmail);
        logVerbose(debugLog, 'נוספה הרשאת עריכה (editor)');
      }

      logInfo(debugLog, 'שיתוף בדרייב בוצע בהצלחה');

    } catch (err) {
      logVerbose(debugLog, 'DRIVE SHARE ERROR: ' + (err.stack || err.message || err));

      const msg = String(err.message || err).toLowerCase();

      if (msg.includes('already') || msg.includes('exists')) {
        logInfo(debugLog, 'אזהרה - למשתמש כבר קיימת הרשאה לקובץ, ממשיכים הלאה');
      } else {
        return fail(
          requestId, debugLog, emailFrom, recipientEmail, fileId, permission,
          'אירעה שגיאה במתן ההרשאה לקובץ. צוות התמיכה עודכן.',
          'שגיאה בשיתוף בדרייב: ' + (err.stack || err.message || err),
          customerSheetId
        );
      }
    }

    logInfo(debugLog, 'שיתוף הושלם בהצלחה (המייל ללקוח נשלח מהאתר, לא מכאן)');
    writeSummaryLog(requestId, emailFrom, recipientEmail, fileId, permission, 'הצלחה', 'שיתוף הושלם בהצלחה. קובץ: ' + fileName, customerSheetId, debugLog);

    return jsonResponse(requestId, true,
      'הגישה לקובץ ניתנה בהצלחה! שם הקובץ: ' + fileName,
      debugLog);

  } catch (err) {
    logVerbose(debugLog, 'קריסה כללית בלתי צפויה: ' + (err.stack || err.message));
    writeSummaryLog(requestId, emailFrom, recipientEmail, fileId, permission, 'כישלון חמור', 'קריסת מערכת: ' + (err.stack || err.message), customerSheetId, debugLog);
    sendCriticalErrorAlert(requestId, emailFrom, recipientEmail, fileId, permission, err);

    return jsonResponse(requestId, false, 'אירעה תקלה כללית במערכת. צוות התמיכה עודכן.', debugLog);
  }
}

// ============================================================
// שכבת אימות
// ============================================================

function authenticateRequest(requestId, customerEmail, customerToken, debugLog) {
  const normalizedEmail = String(customerEmail || '').trim().toLowerCase();

  if (!normalizedEmail || !customerToken) {
    logVerbose(debugLog, 'AUTH: חסר email_from או token בבקשה - לא ניתן לבצע אימות');
    return { authorized: false };
  }

  const expectedToken = computeMd5(normalizedEmail);
  logVerbose(debugLog, 'AUTH: מייל מנורמל: ' + normalizedEmail);
  logVerbose(debugLog, 'AUTH: טוקן שהתקבל מהלקוח: ' + customerToken);

  const authorized = expectedToken === customerToken;
  logVerbose(debugLog, 'AUTH: תוצאת השוואה: ' + (authorized ? 'תואם' : 'לא תואם'));

  if (!authorized) {
    const props = PropertiesService.getScriptProperties();
    const alertOwnerEmail = props.getProperty('ALERT_OWNER_EMAIL');

    if (alertOwnerEmail) {
      sendUnauthorizedAttemptAlert(requestId, normalizedEmail, customerToken, alertOwnerEmail);
    } else {
      logVerbose(debugLog, 'AUTH: ALERT_OWNER_EMAIL אינו מוגדר ב-Script Properties, לא נשלחה התרעה');
    }
  }

  return { authorized: authorized };
}

/**
 * מחשבת MD5 על SECRET + הטקסט הנתון.
 * משמשת גם ל-onboarding (generateToken) וגם לאימות בזמן ריצה (authenticateRequest).
 * חובה לשמור על פונקציה יחידה - אי אפשר לשכפל את הלוגיקה במקום אחר,
 * אחרת תיתכן אי-התאמה בין token שנוצר ל-token שמצופה.
 */
function computeMd5(text) {
  const saltedText = SECRET + text;

  const rawHash = Utilities.computeDigest(
    Utilities.DigestAlgorithm.MD5,
    saltedText,
    Utilities.Charset.UTF_8
  );

  return rawHash.map(function(byte) {
    const v = (byte < 0 ? byte + 256 : byte).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');
}

/**
 * פונקציית Onboarding - מריצים ידנית פעם אחת לכל לקוח חדש (יד תמר, דן וכו').
 * התוצאה (token) נמסרת ללקוח יחד עם הקוד המוכן (Client_Code.gs).
 * ה-SECRET עצמו לעולם לא נמסר ללקוח.
 *
 * שימוש: בעורך הסקריפט, להריץ פעם אחת:
 *   function _onboard() { Logger.log(generateToken('owner@yad-tamar-store.com')); }
 */
function generateToken(customerEmail) {
  const normalizedEmail = String(customerEmail || '').trim().toLowerCase();
  return computeMd5(normalizedEmail);
}

function sendUnauthorizedAttemptAlert(requestId, attemptedEmail, attemptedToken, alertOwnerEmail) {
  try {
    const body =
      'התקבל ניסיון גישה לא מורשה לאפליקציה.\n\n' +
      'מייל שניסה לגשת: ' + attemptedEmail + '\n' +
      'טוקן שנשלח: ' + attemptedToken + '\n' +
      'זמן: ' + new Date().toString() + '\n' +
'מזהה בקשה: ' + requestId + '\n\n' +
'קישור לעורך הסקריפט: ' + SCRIPT_EDITOR_URL;
    GmailApp.sendEmail(
      alertOwnerEmail,
      '[התרעת אבטחה] ניסיון גישה לא מורשה',
      body,
      { htmlBody: wrapRtlHtml(body) }
    );
  } catch (err) {
    console.error('[' + requestId + '] נכשל בשליחת התרעת אבטחה: ' + err.toString());
  }
}

function sendCriticalErrorAlert(requestId, emailFrom, recipientEmail, fileId, permission, err) {
  try {
    const props = PropertiesService.getScriptProperties();
    const adminEmail = props.getProperty('ADMIN_EMAIL');

    if (!adminEmail) {
      console.error('[' + requestId + '] ADMIN_EMAIL לא מוגדר, לא נשלחה התרעת קריסה');
      return;
    }

    const body =
      'אירעה קריסה כללית בסקריפט השיתוף.\n\n' +
      'מזהה בקשה: ' + requestId + '\n' +
      'לקוח (email_from): ' + (emailFrom || 'לא סופק') + '\n' +
      'מקבל שיתוף (recipientEmail): ' + (recipientEmail || 'לא סופק') + '\n' +
      'מזהה קובץ: ' + (fileId || 'לא סופק') + '\n' +
      'הרשאה: ' + (permission || 'לא סופקה') + '\n\n' +
      'פירוט שגיאה:\n' + (err.stack || err.message);

    GmailApp.sendEmail(
      adminEmail,
      '[התרעת מערכת] קריסה כללית בסקריפט השיתוף',
      body,
      { htmlBody: wrapRtlHtml(body) }
    );

  } catch (alertErr) {
    console.error('[' + requestId + '] נכשל בשליחת התרעת קריסה: ' + alertErr.toString());
  }
}

/**
 * שולחת ללקוח (email_from - בעל החנות, כמו "יד תמר") התרעה שהבקשה שלו נכשלה.
 * נשלחת בכל מקרה כשל ולידציה/שיתוף/קובץ - לא במקרה כשל אימות (זה הולך ל-ALERT_OWNER_EMAIL),
 * ולא בקריסה כללית (זה הולך ל-ADMIN_EMAIL).
 */
function sendFailureAlertToOwner(requestId, emailFrom, recipientEmail, fileId, permission, logMessage, debugLog) {
  if (!emailFrom || !isValidEmail(emailFrom)) {
    logVerbose(debugLog, 'לא ניתן לשלוח התרעת כשל ל-email_from - הכתובת חסרה או אינה תקינה');
    return;
  }

  try {
    const body =
      'שלום,\n\n' +
      'ניסיון שיתוף קובץ דרך המערכת נכשל.\n\n' +
      'מזהה בקשה: ' + requestId + '\n' +
      (recipientEmail ? 'מקבל השיתוף שניסית לשתף איתו: ' + recipientEmail + '\n' : '') +
      (fileId ? 'מזהה קובץ: ' + fileId + '\n' : '') +
      (permission ? 'הרשאה מבוקשת: ' + permission + '\n' : '') +
      '\nפירוט הכשל:\n' + logMessage;

    GmailApp.sendEmail(
      emailFrom,
      'שיתוף הקובץ נכשל',
      body,
      { htmlBody: wrapRtlHtml(body) }
    );

    logVerbose(debugLog, 'נשלחה התרעת כשל ל-email_from: ' + emailFrom);

  } catch (err) {
    logVerbose(debugLog, 'נכשל בשליחת התרעת כשל ל-email_from: ' + (err.stack || err.message));
  }
}

function wrapRtlHtml(plainText) {
  return '<div dir="rtl" style="direction: rtl; text-align: right; font-family: Arial, sans-serif; line-height: 1.8;">' +
    escapeHtml(plainText).replace(/\n/g, '<br>') +
    '</div>';
}

// ============================================================
// לוגים
// ============================================================

function logInfo(debugLog, message) {
  Logger.log('[INFO] ' + message);
  debugLog.push('[INFO] ' + message);
}

function logVerbose(debugLog, message) {
  if (VERBOSE_LOGGING_ENABLED) {
    Logger.log('[VERBOSE] ' + message);
    debugLog.push('[VERBOSE] ' + message);
  }
}

function fail(requestId, debugLog, emailFrom, recipientEmail, fileId, permission, userMessage, logMessage, customerSheetId) {
  logVerbose(debugLog, 'FAIL: ' + logMessage);
  writeSummaryLog(requestId, emailFrom, recipientEmail, fileId, permission, 'כישלון', logMessage, customerSheetId, debugLog);
  sendFailureAlertToOwner(requestId, emailFrom, recipientEmail, fileId, permission, logMessage, debugLog);
  return jsonResponse(requestId, false, userMessage, debugLog);
}

/**
 * כותבת שורת סיכום ללוג הפנימי (LOG_SPREADSHEET_ID, שלך בלבד).
 * אם סופק customerSheetId - כותבת בנוסף אותה שורה גם לגליון של הלקוח (best-effort,
 * ראו writeCustomerSheetLog). כשל בכתיבה לגליון הלקוח לעולם לא זורק שגיאה החוצה
 * ולא פוגע בכתיבה ללוג הפנימי.
 */
function writeSummaryLog(requestId, emailFrom, recipientEmail, fileId, permission, result, detailedMessage, customerSheetId, debugLog) {
  const lock = LockService.getScriptLock();
  let locked = false;

  try {
    lock.waitLock(15000);
    locked = true;

    const ss = SpreadsheetApp.openById(LOG_SPREADSHEET_ID);
    if (!ss) {
      console.error('[' + requestId + '] אין Spreadsheet פעיל לכתיבת לוג סיכום');
    } else {
      let sheet = ss.getSheetByName(LOG_SHEET_NAME);
      if (!sheet) {
        sheet = ss.insertSheet(LOG_SHEET_NAME);
        sheet.appendRow(['תאריך ושעה', 'מזהה בקשה', 'לקוח (email_from)', 'מקבל שיתוף', 'מזהה קובץ', 'הרשאה', 'תוצאה', 'פירוט']);
      }

      sheet.appendRow([
        new Date(), requestId || '-', emailFrom || '-', recipientEmail || '-', fileId || '-',
        permission || '-', result || '-', detailedMessage || '-'
      ]);
    }

  } catch (err) {
    console.error('[' + requestId + '] שגיאה בכתיבת לוג סיכום: ' + err.toString());
  } finally {
    if (locked) {
      try { lock.releaseLock(); } catch (err) { /* ignore */ }
    }
  }

  // כתיבה (best-effort, לא חוסמת ולא זורקת) לגליון הלוג של הלקוח, אם סופק מזהה כזה
  if (customerSheetId) {
    writeCustomerSheetLog(requestId, customerSheetId, emailFrom, recipientEmail, fileId, permission, result, detailedMessage, debugLog);
  }
}

/**
 * כותבת שורת לוג לגליון Google Sheet שהלקוח עצמו סיפק (customerSheetId), בנוסף
 * ללוג הפנימי. שימושי כדי שלכל לקוח (יד תמר, דן וכו') יהיה עותק של הלוג שלו
 * בגליון משלו, בלי גישה לגליון הפנימי שלך.
 *
 * הערות חשובות:
 * - הכתיבה היא best-effort: כל שגיאה (מזהה גליון שגוי, אין הרשאת עריכה וכו')
 *   נרשמת ל-debugLog/console.error אך לא משפיעה על שאר הבקשה.
 * - אם הפונקציה קרויה מתוך shareFile() (קריאת ספרייה), הקוד רץ תחת חשבון הלקוח,
 *   כך שהכתיבה תעבוד כל עוד ל"לקוח" יש הרשאת עריכה לגליון שהוא עצמו סיפק (שזה
 *   המצב הרגיל, כי זה הגליון שלו).
 * - אם הפונקציה קרויה מתוך doGet() (Web App), הקוד רץ לפי הגדרת הפריסה
 *   (בדרך כלל "Execute as: Me" - כלומר תחת חשבונך). במקרה כזה כתיבה לגליון של
 *   הלקוח תעבוד רק אם הלקוח שיתף את הגליון שלו עם חשבונך בהרשאת עריכה.
 */
function writeCustomerSheetLog(requestId, customerSheetId, emailFrom, recipientEmail, fileId, permission, result, detailedMessage, debugLog) {
  try {
    const ss = SpreadsheetApp.openById(customerSheetId);
    if (!ss) {
      console.error('[' + requestId + '] לא נמצא Google Sheet של הלקוח למזהה: ' + customerSheetId);
      if (debugLog) logVerbose(debugLog, 'כתיבה לגליון הלקוח נכשלה - הגליון לא נמצא: ' + customerSheetId);
      return;
    }

    let sheet = ss.getSheetByName(LOG_SHEET_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(LOG_SHEET_NAME);
      sheet.appendRow(['תאריך ושעה', 'מזהה בקשה', 'לקוח (email_from)', 'מקבל שיתוף', 'מזהה קובץ', 'הרשאה', 'תוצאה', 'פירוט']);
    }

    sheet.appendRow([
      new Date(), requestId || '-', emailFrom || '-', recipientEmail || '-', fileId || '-',
      permission || '-', result || '-', detailedMessage || '-'
    ]);

    if (debugLog) logVerbose(debugLog, 'נכתבה שורת לוג לגליון הלקוח (' + customerSheetId + ')');

  } catch (err) {
    console.error('[' + requestId + '] שגיאה בכתיבה לגליון הלקוח (' + customerSheetId + '): ' + err.toString());
    if (debugLog) logVerbose(debugLog, 'שגיאה בכתיבה לגליון הלקוח (' + customerSheetId + '): ' + (err.stack || err.message));
  }
}

// ============================================================
// עזרים
// ============================================================

function normalizeParameterKeys(rawParams) {
  const result = {};
  Object.keys(rawParams || {}).forEach(function(key) {
    result[String(key).toLowerCase()] = rawParams[key];
  });
  return result;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function isValidHttpUrl(url) {
  return /^https?:\/\/.+/i.test(String(url || '').trim());
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function jsonResponse(requestId, success, message, debugLog) {
  return ContentService
    .createTextOutput(JSON.stringify({
      requestId: requestId,
      success: success,
      message: message,
      debugLog: debugLog
    }))
    .setMimeType(ContentService.MimeType.JSON);
}

// const LOG_SHEET_NAME = 'לוגים';
// const ADMIN_EMAIL = 'dorbari120@gmail.com';
// const EMAIL_DRAFT_SUBJECT = 'שיתוף';

// function doGet(e) {
//   const requestId = Utilities.getUuid();
//   logConsole(requestId, 'בסיעתא דשמיא רבה מ');

//   let email = '';
//   let fileId = '';
//   let permission = '';
//   let fileName = '';
//   let fileUrl = '';

//   try {
//     logConsole(requestId, '--- התחלת טיפול בבקשה חדשה ---');

//     const rawParams = (e && e.parameter) ? e.parameter : {};
//     const params = normalizeParameterKeys(rawParams);

//     logConsole(requestId, 'פרמטרים שהתקבלו לאחר המרה לאותיות קטנות: ' + JSON.stringify(params));

//     email = (params.email || '').trim();
//     fileId = (params.fileid || '').trim();
//     permission = (params.permission || '').trim().toLowerCase();

//     logConsole(requestId, 'EMAIL: ' + email);
//     logConsole(requestId, 'FILE ID: [' + fileId + ']');
//     logConsole(requestId, 'PERMISSION: ' + permission);

//     writeLog(requestId, email, fileId, permission, 'התחלה', 'התקבלה בקשה חדשה');

//     if (!email) {
//       return fail(requestId, email, fileId, permission, 'לא הצלחנו למצוא את כתובת המייל שלך', 'חסר פרמטר email', true);
//     }

//     if (!isValidEmail(email)) {
//       return fail(requestId, email, fileId, permission, 'כתובת המייל אינה תקינה', 'כתובת מייל לא תקינה: ' + email, true);
//     }

//     if (!fileId) {
//       return fail(requestId, email, fileId, permission, 'מזהה הקובץ חסר או אינו תקין', 'חסר פרמטר fileID/fileId', true);
//     }

//     if (!['viewer', 'editor'].includes(permission)) {
//       return fail(requestId, email, fileId, permission, 'סוג ההרשאה אינו תקין', 'permission לא תקין: ' + permission, true);
//     }

//     writeLog(requestId, email, fileId, permission, 'ולידציה תקינה', 'כל הפרמטרים תקינים');

//     let file;

//     try {
//       logConsole(requestId, 'שלב 1 - לפני getFileById');

//       file = DriveApp.getFileById(fileId);

//       logConsole(requestId, 'שלב 2 - נמצא אובייקט קובץ');

//       fileName = file.getName();

//       logConsole(requestId, 'שלב 3 - fileName: ' + fileName);

//       fileUrl = file.getUrl();

//       logConsole(requestId, 'שלב 4 - fileUrl: ' + fileUrl);

//     } catch (err) {
//       logConsole(requestId, 'CRASH LOCATION: ' + (err.stack || err.message));

//       return fail(
//         requestId,
//         email,
//         fileId,
//         permission,
//         'הקובץ שביקשת כרגע אינו זמין או שהקישור אינו תקין. אנא נסו שוב מאוחר יותר או פנו לבעלת המערכת.',
//         'קובץ לא נמצא / אין הרשאה לקובץ. שגיאה: ' + (err.stack || err.message),
//         true,
//         'קובץ לא נמצא בדרייב'
//       );
//     }

//     if (!fileUrl || !isValidHttpUrl(fileUrl)) {
//       return fail(
//         requestId,
//         email,
//         fileId,
//         permission,
//         'קישור הקובץ אינו תקין. צוות התמיכה עודכן.',
//         'URL לא תקין לקובץ: ' + fileUrl,
//         true,
//         'קישור קובץ לא תקין'
//       );
//     }

//     writeLog(requestId, email, fileId, permission, 'קובץ נמצא', 'שם קובץ: ' + fileName + ', קישור: ' + fileUrl);

//     try {
//       writeLog(requestId, email, fileId, permission, 'לפני שיתוף', 'מתחיל שיתוף קובץ בדרייב');

//       if (permission === 'viewer') {
//         file.addViewer(email);
//       } else {
//         file.addEditor(email);
//       }

//       writeLog(requestId, email, fileId, permission, 'שיתוף בוצע', 'ההרשאה ניתנה בהצלחה בדרייב');

//     } catch (err) {
//       logConsole(requestId, 'DRIVE SHARE ERROR: ' + (err.stack || err.message || err));

//       const msg = String(err.message || err).toLowerCase();

//       if (msg.includes('already') || msg.includes('exists')) {
//         writeLog(requestId, email, fileId, permission, 'אזהרה - הרשאה כבר קיימת', 'למשתמש כבר קיימת הרשאה לקובץ');
//       } else {
//         return fail(
//           requestId,
//           email,
//           fileId,
//           permission,
//           'אירעה שגיאה במתן ההרשאה לקובץ. צוות התמיכה עודכן.',
//           'שגיאה בשיתוף בדרייב: ' + (err.stack || err.message || err),
//           true,
//           'שגיאה במתן הרשאה בדרייב'
//         );
//       }
//     }

//     const emailResult = sendStyledEmailSafe(requestId, email, fileName, fileUrl, fileId, permission);

//     if (!emailResult.success) {
//       writeLog(
//         requestId,
//         email,
//         fileId,
//         permission,
//         'כשל חלקי',
//         'השיתוף בדרייב הצליח, אך שליחת המייל למשתמש נכשלה: ' + emailResult.error
//       );

//       sendAdminAlertSafe(
//         requestId,
//         'כשל חלקי - ההרשאה ניתנה אך המייל למשתמש נכשל',
//         buildAdminAlertBody(
//           'ההרשאה בדרייב ניתנה בהצלחה, אך שליחת המייל למשתמש נכשלה.',
//           [
//             'מייל משתמש: ' + email,
//             'שם קובץ: ' + fileName,
//             'קישור קובץ: ' + fileUrl,
//             'הרשאה: ' + permission
//           ],
//           'פירוט שגיאה:\n' + emailResult.error
//         )
//       );

//       // return htmlResponse('הגישה לקובץ ניתנה בהצלחה, אך הייתה תקלה בשליחת המייל. צוות התמיכה עודכן.', '#ef6c00'); //כאן החלפתי HTML
//       return htmlResponse('הגישה לקובץ ניתנה בהצלחה! <br><br>שם הקובץ: <strong>' + escapeHtml(fileName) + '</strong><br><a href="' + escapeHtml(fileUrl) + '" target="_blank">לחץ כאן לפתיחת הקובץ</a>', '#2e7d32');
//     }

//       writeLog(requestId, email, fileId, permission, 'הצלחה מלאה', 'השיתוף הצליח והמייל למשתמש נשלח בהצלחה');


//     // return htmlResponse('הגישה לקובץ ניתנה בהצלחה! מייל עם קישור ישיר נשלח אליך.', '#2e7d32'); //כאן החלפתי HTML
// return htmlResponse('הגישה לקובץ ניתנה בהצלחה! מייל עם קישור ישיר נשלח אליך.<br><br>שם הקובץ: <strong>' + escapeHtml(fileName) + '</strong><br><a href="' + escapeHtml(fileUrl) + '" target="_blank">לחץ כאן לפתיחת הקובץ</a>', '#2e7d32');
//   } catch (err) {
//     writeLog(requestId, email, fileId, permission, 'כישלון חמור', 'קריסה כללית: ' + (err.stack || err.message));

//     sendAdminAlertSafe(
//       requestId,
//       'קריסת מערכת כללית בסקריפט השיתוף',
//       buildAdminAlertBody(
//         'אירעה שגיאה כללית בלתי צפויה.',
//         [
//           'מייל משתמש: ' + (email || 'לא סופק'),
//           'הרשאה: ' + (permission || 'לא סופקה')
//         ],
//         'פירוט שגיאה:\n' + (err.stack || err.message)
//       )
//     );

//     return htmlResponse('אירעה תקלה כללית במערכת. צוות התמיכה עודכן ויטפל בכך.', '#c62828');
//   }
// }

// function fail(requestId, email, fileId, permission, userMessage, logMessage, alertAdmin, alertSubject) {
//   writeLog(requestId, email, fileId, permission, 'כישלון', logMessage);

//   if (alertAdmin) {
//     sendAdminAlertSafe(
//       requestId,
//       alertSubject || 'כשל בבקשת שיתוף קובץ',
//       buildAdminAlertBody(
//         'אירע כשל בבקשת שיתוף קובץ.',
//         [
//           'מייל משתמש: ' + (email || 'לא סופק'),
//           'הרשאה: ' + (permission || 'לא סופקה')
//         ],
//         'פירוט:\n' + logMessage
//       )
//     );
//   }

//   return htmlResponse(userMessage, '#c62828');
// }

// function normalizeParameterKeys(rawParams) {
//   const result = {};

//   Object.keys(rawParams || {}).forEach(function(key) {
//     result[String(key).toLowerCase()] = rawParams[key];
//   });

//   return result;
// }

// function sendStyledEmailSafe(requestId, targetEmail, fileName, fileUrl, fileId, permission) {
//   try {
//     logConsole(requestId, 'מחפש טיוטת Gmail בשם: ' + EMAIL_DRAFT_SUBJECT);

//     const drafts = GmailApp.getDraftMessages();
//     let draft = null;

//     for (let i = 0; i < drafts.length; i++) {
//       const subject = drafts[i].getSubject();

//       if (subject && subject.trim() === EMAIL_DRAFT_SUBJECT) {
//         draft = drafts[i];
//         break;
//       }
//     }

//     if (!draft) {
//       throw new Error('לא נמצאה טיוטת Gmail בשם "' + EMAIL_DRAFT_SUBJECT + '"');
//     }

//     logConsole(requestId, 'נמצאה טיוטת Gmail');

//     const htmlBody = draft.getBody()
//       .replace(/{{fileName}}/g, fileName)
//       .replace(/{{fileUrl}}/g, fileUrl);

//     logConsole(requestId, 'שולח מייל למשתמש');

//     GmailApp.sendEmail(targetEmail, draft.getSubject(), '', {
//       htmlBody: htmlBody
//     });

//     writeLog(requestId, targetEmail, fileId, permission, 'מייל נשלח', 'המייל נשלח בהצלחה');

//     return {
//       success: true,
//       error: ''
//     };

//   } catch (err) {
//     const errorText = err.stack || err.message || String(err);

//     logConsole(requestId, 'EMAIL ERROR: ' + errorText);

//     sendAdminAlertSafe(
//       requestId,
//       'שגיאה אמיתית בשליחת מייל',
//       buildAdminAlertBody(
//         'אירעה שגיאה בשליחת מייל למשתמש.',
//         [],
//         'פירוט שגיאה:\n' + errorText
//       )
//     );

//     return {
//       success: false,
//       error: errorText
//     };
//   }
// }

// function sendAdminAlertSafe(requestId, subject, body) {
//   try {

//     const htmlBody =
//       '<div dir="rtl" style="direction: rtl; text-align: right; font-family: Arial, sans-serif; line-height: 1.8;">' +
//       body
//         .replace(/\n/g, '<br>') +
//       '</div>';

//     GmailApp.sendEmail(
//       ADMIN_EMAIL,
//       '[התרעת מערכת] ' + subject,
//       '',
//       {
//         htmlBody: htmlBody
//       }
//     );

//     logConsole(requestId, 'נשלחה התרעת אדמין: ' + subject);

//   } catch (err) {
//     console.error(
//       '[' + requestId + '] נכשל בשליחת התרעת אדמין: ' +
//       err.toString()
//     );
//   }
// }

// function buildAdminAlertBody(mainMessage, details, footer) {
//   let body = 'שלום,\n\n' + mainMessage + '\n\n';

//   if (details && details.length) {
//     body += details.join('\n') + '\n\n';
//   }

//   if (footer) {
//     body += footer;
//   }

//   return body;
// }

// function writeLog(requestId, email, fileId, permission, result, detailedMessage) {
//   const lock = LockService.getScriptLock();
//   let locked = false;

//   try {
//     lock.waitLock(15000);
//     locked = true;

//     const ss = SpreadsheetApp.getActiveSpreadsheet();

//     if (!ss) {
//       console.error('[' + requestId + '] אין Spreadsheet פעיל לכתיבת לוג');
//       return;
//     }

//     let sheet = ss.getSheetByName(LOG_SHEET_NAME);

//     if (!sheet) {
//       sheet = ss.insertSheet(LOG_SHEET_NAME);
//       sheet.appendRow([
//         'תאריך ושעה',
//         'מזהה בקשה',
//         'מייל משתמש',
//         'מזהה קובץ',
//         'הרשאה',
//         'תוצאה',
//         'פירוט'
//       ]);
//     }

//     sheet.appendRow([
//       new Date(),
//       requestId || 'לא סופק',
//       email || 'לא סופק',
//       fileId || 'לא סופק',
//       permission || 'לא סופק',
//       result || 'לא סופק',
//       detailedMessage || 'לא סופק'
//     ]);

//   } catch (err) {
//     console.error('[' + requestId + '] שגיאה בכתיבת לוג: ' + err.toString());

//   } finally {
//     if (locked) {
//       try {
//         lock.releaseLock();
//       } catch (err) {
//         console.error('[' + requestId + '] שגיאה בשחרור נעילה: ' + err.toString());
//       }
//     }
//   }
// }

// function isValidEmail(email) {
//   return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
// }

// function isValidHttpUrl(url) {
//   return /^https?:\/\/.+/i.test(String(url || '').trim());
// }

// // function htmlResponse(message, textColor) {
// //   const safeColor = escapeHtml(textColor);
// //   const safeMessage = escapeHtml(message);

// //   return HtmlService.createHtmlOutput(
// //     '<!DOCTYPE html>' +
// //     '<html lang="he" dir="rtl">' +
// //       '<head>' +
// //         '<base target="_top">' +
// //         '<meta charset="UTF-8">' +
// //       '</head>' +
// //       '<body dir="rtl" style="direction: rtl; text-align: right; margin: 0;">' +
// //         '<main style="font-family: Arial, sans-serif; direction: rtl; text-align: right; margin: 80px auto 0; padding: 20px; max-width: 600px; line-height: 1.6;">' +
// //           '<h2 style="color: ' + safeColor + '; font-size: 22px; text-align: right;">' + safeMessage + '</h2>' +
// //         '</main>' +
// //       '</body>' +
// //     '</html>'
// //   );
// // }
// function htmlResponse(message, textColor) {
//   const safeColor = escapeHtml(textColor);

//   return HtmlService.createHtmlOutput(
//     '<!DOCTYPE html>' +
//     '<html lang="he" dir="rtl">' +
//       '<head>' +
//         '<base target="_top">' +
//         '<meta charset="UTF-8">' +
//       '</head>' +
//       '<body dir="rtl" style="direction: rtl; text-align: right; margin: 0;">' +
//         '<main style="font-family: Arial, sans-serif; direction: rtl; text-align: right; margin: 80px auto 0; padding: 20px; max-width: 600px; line-height: 1.6;">' +
//           '<h2 style="color: ' + safeColor + '; font-size: 22px; text-align: right;">' + message + '</h2>' +
//         '</main>' +
//       '</body>' +
//     '</html>'
//   );
// }

// function escapeHtml(text) {
//   return String(text || '')
//     .replace(/&/g, '&amp;')
//     .replace(/</g, '&lt;')
//     .replace(/>/g, '&gt;')
//     .replace(/"/g, '&quot;')
//     .replace(/'/g, '&#039;');
// }

// function logConsole(requestId, message) {
//   console.log('[' + requestId + '] ' + message);
// }

/**
 * ============================================================
 *  shareFile - הפונקציה הציבורית שנקראת ע"י הלקוחות דרך Library
 *  רצה תחת חשבון הגוגל של הלקוח שקורא לה (יש לו גישה לדרייב שלו)
 *  אבל הלוגיקה/הקוד עצמו מוגן ולא חשוף ללקוח.
 * ============================================================
 */
function shareFile(customerEmail, customerToken, recipientEmail, fileId, permission, messageText, customerSheetId) {
  Logger.log('[shareFile] כניסה לפונקציה | גרסת קוד: ' + SCRIPT_VERSION_TAG);
  const requestId = Utilities.getUuid();
  const debugLog = [];

  const emailFrom = String(customerEmail || '').trim();
  recipientEmail = String(recipientEmail || '').trim();
  fileId = String(fileId || '').trim();
  permission = String(permission || '').trim().toLowerCase();
  messageText = messageText || '';
  customerSheetId = String(customerSheetId || '').trim();

  let fileName = '';
  let fileUrl = '';

  try {
    logInfo(debugLog, 'בקשה התקבלה דרך הספרייה');
    logVerbose(debugLog, 'email_from שהתקבל: ' + emailFrom);
    logVerbose(debugLog, 'token שהתקבל: ' + customerToken);
    logVerbose(debugLog, 'sheetId (גליון לוג של הלקוח) סופק: ' + (customerSheetId ? customerSheetId : 'לא'));

    const authResult = authenticateRequest(requestId, emailFrom, customerToken, debugLog);

    if (!authResult.authorized) {
      logVerbose(debugLog, 'אימות נכשל - הבקשה נחסמת');
      // בכוונה לא מעבירים customerSheetId כאן - לפני אימות מוצלח לא כותבים לגליון חיצוני כלשהו
      writeSummaryLog(requestId, emailFrom, '', '', '', 'כישלון אימות', 'טוקן שגוי או חסר עבור email_from: ' + emailFrom, '', debugLog);
      Logger.log('[shareFile] לפני return (אימות נכשל) - success=false');
      return { requestId: requestId, success: false, message: 'הבקשה נחסמה: אין הרשאה להשתמש בשירות זה', debugLog: debugLog };
    }

    logInfo(debugLog, 'אימות עבר בהצלחה');

    if (!isValidEmail(emailFrom)) {
      logVerbose(debugLog, 'email_from אינו בפורמט מייל תקין, לא יישלחו אליו התרעות כשל');
    }

    logVerbose(debugLog, 'recipientEmail: ' + recipientEmail);
    logVerbose(debugLog, 'fileId: [' + fileId + ']');
    logVerbose(debugLog, 'permission: ' + permission);

    if (!recipientEmail) {
      Logger.log('[shareFile] לפני return (fail) - חסר recipientEmail');
      return failLib(requestId, debugLog, emailFrom, recipientEmail, fileId, permission, 'לא הצלחנו למצוא את כתובת המייל של מקבל השיתוף', 'חסר פרמטר recipientEmail', customerSheetId);
    }

    if (!isValidEmail(recipientEmail)) {
      Logger.log('[shareFile] לפני return (fail) - recipientEmail לא תקין');
      return failLib(requestId, debugLog, emailFrom, recipientEmail, fileId, permission, 'כתובת המייל של מקבל השיתוף אינה תקינה', 'כתובת מייל לא תקינה: ' + recipientEmail, customerSheetId);
    }

    if (!fileId) {
      Logger.log('[shareFile] לפני return (fail) - חסר fileId');
      return failLib(requestId, debugLog, emailFrom, recipientEmail, fileId, permission, 'מזהה הקובץ חסר או אינו תקין', 'חסר פרמטר fileId', customerSheetId);
    }

    if (!['viewer', 'editor'].includes(permission)) {
      Logger.log('[shareFile] לפני return (fail) - permission לא תקין');
      return failLib(requestId, debugLog, emailFrom, recipientEmail, fileId, permission, 'סוג ההרשאה אינו תקין', 'permission לא תקין: ' + permission, customerSheetId);
    }

    logInfo(debugLog, 'ולידציה תקינה');

    let file;

    try {
      logVerbose(debugLog, 'לפני קריאה ל-getFileById (רץ עם הרשאות הלקוח הקורא)');
      file = DriveApp.getFileById(fileId);
      fileName = file.getName();
      fileUrl = file.getUrl();
      logVerbose(debugLog, 'נמצא קובץ: ' + fileName);

    } catch (err) {
      logVerbose(debugLog, 'CRASH LOCATION (אחזור קובץ): ' + (err.stack || err.message));
      Logger.log('[shareFile] לפני return (fail) - שגיאה באחזור הקובץ: ' + (err.stack || err.message));
      return failLib(
        requestId, debugLog, emailFrom, recipientEmail, fileId, permission,
        'הקובץ שביקשת כרגע אינו זמין או שהקישור אינו תקין. אנא נסו שוב מאוחר יותר.',
        'קובץ לא נמצא / אין הרשאה לקובץ',
        customerSheetId
      );
    }

    if (!fileUrl || !isValidHttpUrl(fileUrl)) {
      Logger.log('[shareFile] לפני return (fail) - fileUrl לא תקין: ' + fileUrl);
      return failLib(requestId, debugLog, emailFrom, recipientEmail, fileId, permission, 'קישור הקובץ אינו תקין.', 'URL לא תקין לקובץ: ' + fileUrl, customerSheetId);
    }

    logInfo(debugLog, 'קובץ אותר בהצלחה: ' + fileName);

    try {
      if (permission === 'viewer') {
        file.addViewer(recipientEmail);
      } else {
        file.addEditor(recipientEmail);
      }
      logInfo(debugLog, 'שיתוף בדרייב בוצע בהצלחה');

    } catch (err) {
      logVerbose(debugLog, 'DRIVE SHARE ERROR: ' + (err.stack || err.message || err));
      const msg = String(err.message || err).toLowerCase();

      if (msg.includes('already') || msg.includes('exists')) {
        logInfo(debugLog, 'אזהרה - הרשאה כבר קיימת, ממשיכים');
      } else {
        Logger.log('[shareFile] לפני return (fail) - שגיאה בשיתוף בדרייב');
        return failLib(
          requestId, debugLog, emailFrom, recipientEmail, fileId, permission,
          'אירעה שגיאה במתן ההרשאה לקובץ.',
          'שגיאה בשיתוף בדרייב: ' + (err.stack || err.message || err),
          customerSheetId
        );
      }
    }

    logInfo(debugLog, 'שיתוף הושלם בהצלחה (המייל ללקוח נשלח מהאתר, לא מכאן)');
    writeSummaryLog(requestId, emailFrom, recipientEmail, fileId, permission, 'הצלחה', 'שיתוף הושלם בהצלחה. קובץ: ' + fileName, customerSheetId, debugLog);

    Logger.log('[shareFile] לפני return (הצלחה מלאה) - success=true, fileName=' + fileName);
    return { requestId: requestId, success: true, message: 'הגישה לקובץ ניתנה בהצלחה! שם הקובץ: ' + fileName, debugLog: debugLog };

  } catch (err) {
    logVerbose(debugLog, 'קריסה כללית בלתי צפויה: ' + (err.stack || err.message));
    writeSummaryLog(requestId, emailFrom, recipientEmail, fileId, permission, 'כישלון חמור', 'קריסת מערכת: ' + (err.stack || err.message), customerSheetId, debugLog);
    sendCriticalErrorAlert(requestId, emailFrom, recipientEmail, fileId, permission, err);
    Logger.log('[shareFile] לפני return (קריסה כללית) - success=false');
    return { requestId: requestId, success: false, message: 'אירעה תקלה כללית במערכת.', debugLog: debugLog };
  }
}

/**
 * גרסת fail המתאימה לקריאת ספרייה - מחזירה אובייקט JS רגיל במקום jsonResponse.
 */
function failLib(requestId, debugLog, emailFrom, recipientEmail, fileId, permission, userMessage, logMessage, customerSheetId) {
  logVerbose(debugLog, 'FAIL: ' + logMessage);
  writeSummaryLog(requestId, emailFrom, recipientEmail, fileId, permission, 'כישלון', logMessage, customerSheetId, debugLog);
  sendFailureAlertToOwner(requestId, emailFrom, recipientEmail, fileId, permission, logMessage, debugLog);
  Logger.log('[failLib] לפני return - success=false, userMessage: ' + userMessage);
  return { requestId: requestId, success: false, message: userMessage, debugLog: debugLog };
}
