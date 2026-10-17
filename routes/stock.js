const express = require('express');
const { authRequired } = require('../middleware/auth');
const { listMovements } = require('../stock_journal');

const router = express.Router();

router.get('/movements', authRequired, async (req, res) => {
  try {
    const rows = await listMovements({ k: req.query.k, limit: req.query.limit });
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
