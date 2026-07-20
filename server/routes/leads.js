const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../db');
const { callShareWebhook } = require('../services/fulfillment');
const { sendGiftStory, sendOfficeNotification } = require('../services/email');

// סיפור המתנה הקבוע — story_code '76' ("שלמה המלך ומלכות שבא"). ה-Google Drive file ID
// עצמו נשלף מה-DB בכל בקשה (לא נשמר כקבוע כאן) כדי להישאר מסונכרן אוטומטית אם יתעדכן
// אי-פעם דרך admin/seed-catalog.
const GIFT_STORY_CODE = '76';

// POST /api/leads — סיפור מתנה / כידת ליד
router.post('/', async (req, res) => {
  const { name, email, phone, gift_story_id } = req.body;
  if (!name || !email) return res.status(400).json({ error: 'שם ומייל נדרשים' });
  const id = await db.createLead({ name, email, phone: phone || null, gift_story_id: gift_story_id || null });

  // שיתוף סיפור המתנה בפועל (שלב 2 הקיים, share-lib.gs — משתף קובץ בודד + שולח מייל
  // ללקוח בעצמו). לא זורק לעולם — הלקוח מקבל תשובת success גם אם השיתוף נכשל, כדי
  // שהמשרד יוכל לטפל ידנית (ראו מייל המשרד למטה).
  try {
    const story = await db.getStoryByCode(GIFT_STORY_CODE);
    if (story && story.googleDriveFileId && !story.googleDriveFileId.startsWith('PENDING')) {
      const requestId = crypto.randomUUID();
      const shareResult = await callShareWebhook(story.googleDriveFileId, email, requestId);
      if (shareResult.success) {
        await sendGiftStory({
          name, email,
          storyTitle: story.title,
          storyLink: `https://drive.google.com/file/d/${story.googleDriveFileId}/view`,
        });
        await db.updateLead(id, { gift_sent: true });
      }
      await sendOfficeNotification({
        subject: `סיפור מתנה — ${name}`,
        html: `<div dir="rtl" style="font-family:sans-serif">
          <h2>בקשת סיפור מתנה</h2>
          <p>פרטי הפונה: ${name} | ${email}${phone ? ' | ' + phone : ''}</p>
          <p>סיפור: ${story.title} (מס' ${GIFT_STORY_CODE})</p>
          <p>סטטוס שיתוף: ${shareResult.success ? '✅ נשלח בהצלחה' : '❌ נכשל — ' + (shareResult.errorCode || 'לא ידוע') + (shareResult.errorMessage ? ' (' + shareResult.errorMessage + ')' : '')}</p>
        </div>`,
      });
    } else {
      console.error('[leads] gift story not found or missing a real Drive file ID');
    }
  } catch (e) {
    console.error('[leads] gift story sharing failed:', e.message);
  }

  res.json({ success: true, id });
});

module.exports = router;
