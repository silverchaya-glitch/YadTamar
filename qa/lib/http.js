// עטיפת fetch דקה לקריאות מול השרת החי (ברירת מחדל: production על אותה מכונה,
// אין סביבת staging נפרדת — ראה qa/README.md). משתמשת ב-fetch המובנה של Node 18+,
// בלי תלות חדשה.

const BASE_URL = process.env.QA_BASE_URL || 'http://127.0.0.1:3000';

function extractCookie(setCookieHeader) {
  if (!setCookieHeader) return null;
  return setCookieHeader.split(';')[0];
}

async function request(pathName, { method = 'GET', body, cookie } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers['Cookie'] = cookie;
  const res = await fetch(BASE_URL + pathName, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const setCookie = extractCookie(res.headers.get('set-cookie'));
  let json = null;
  try { json = await res.json(); } catch { /* לא JSON — לא כל תגובה חייבת להיות */ }
  return { status: res.status, body: json, cookie: setCookie };
}

module.exports = { BASE_URL, request };
