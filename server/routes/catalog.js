const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/catalog — קטגוריות + סיפורים פעילים, ציבורי (ללא אימות)
router.get('/', async (req, res) => {
  try {
    res.json(await db.getCatalog());
  } catch (e) {
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

module.exports = router;
