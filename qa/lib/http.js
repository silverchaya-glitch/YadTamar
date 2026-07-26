// עטיפת fetch דקה לקריאות מול השרת החי (ברירת מחדל: production על אותה מכונה,
// אין סביבת staging נפרדת — ראה qa/README.md). משתמשת ב-fetch המובנה של Node 18+,
// בלי תלות חדשה.

const BASE_URL = process.env.QA_BASE_URL || 'http://127.0.0.1:3000';

function extractCookie(setCookieHeader) {
  if (!setCookieHeader) return null;
  return setCookieHeader.split(';')[0];
}

// timeoutMs אופציונלי (ברירת מחדל: בלי timeout, כמו קודם) — משמש בעיקר את
// בדיקות העומס (qa/load-*.test.js), כדי שקריאה תקועה (למשל אחרי קריסת שרת)
// תיכשל מהר במקום לתלות את הבדיקה לנצח.
async function request(pathName, { method = 'GET', body, cookie, timeoutMs } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers['Cookie'] = cookie;
  const controller = timeoutMs ? new AbortController() : null;
  const timer = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await fetch(BASE_URL + pathName, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller?.signal,
    });
    const setCookie = extractCookie(res.headers.get('set-cookie'));
    let json = null;
    try { json = await res.json(); } catch { /* לא JSON — לא כל תגובה חייבת להיות */ }
    return { status: res.status, body: json, cookie: setCookie };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

module.exports = { BASE_URL, request };
