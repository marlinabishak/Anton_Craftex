const express = require('express');
const router = express.Router();
const db = require('../config/db');

router.post('/enquiry', async (req, res) => {
  try {
    const { name, email, phone, interest, message, preferred_date, group_size } = req.body;
    await db.query(`
      INSERT INTO craft_park_enquiries (name, email, phone, interest, message, preferred_date, group_size)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [name, email, phone, interest, message, preferred_date, group_size]);
    res.json({ success: true, message: 'Thank you! We will contact you within 24 hours.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;