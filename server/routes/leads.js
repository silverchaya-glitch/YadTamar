const express = require('express');
const router = express.Router();
const db = require('../db');

// POST /api/leads — סיפור מתנה / כידת ליד
router.post('/', async (req, res) => {
  const { name, email, phone, gift_story_id } = req.body;
  if (!name || !email) return res.status(400).json({ error: 'שם ומייל נדרשים' });
  const id = await db.createLead({ name, email, phone: phone || null, gift_story_id: gift_story_id || null });
  res.json({ success: true, id });
});

module.exports = router;
