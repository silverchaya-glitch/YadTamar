// מדפיס את כתובת ההרשאה (authorization URL) שיש לפתוח בדפדפן כדי לאשר שליחת מייל דרך Gmail API.
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const CLIENT_ID = process.env.GMAIL_OAUTH_CLIENT_ID;
const REDIRECT_URI = 'https://shop.emanuel-tehila.co.il/api/oauth2/gmail/callback';
const SCOPE = 'https://www.googleapis.com/auth/gmail.send';

if (!CLIENT_ID) {
  console.error('חסר GMAIL_OAUTH_CLIENT_ID ב-.env');
  process.exit(1);
}

const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
url.searchParams.set('client_id', CLIENT_ID);
url.searchParams.set('redirect_uri', REDIRECT_URI);
url.searchParams.set('response_type', 'code');
url.searchParams.set('scope', SCOPE);
url.searchParams.set('access_type', 'offline');
url.searchParams.set('prompt', 'consent');
url.searchParams.set('login_hint', 'yadtamar613@gmail.com');

console.log(url.toString());
