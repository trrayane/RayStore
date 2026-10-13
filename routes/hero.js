const express = require('express');
const { query } = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

router.get('/', async (req, res) => {
  const result = await query('SELECT item_id FROM hero ORDER BY sort_order ASC, id ASC');
  res.json(result.rows.map((r) => r.item_id));
});

router.put('/', authRequired, async (req, res) => {
  const list = Array.isArray(req.body?.items) ? req.body.items : [];
  const clean = list.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 20);
  const client = await require('../db').pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM hero');
    for (let i = 0; i < clean.length; i++) {
      await client.query('INSERT INTO hero (item_id, sort_order) VALUES ($1,$2)', [clean[i], i]);
    }
    await client.query('COMMIT');
    res.json({ success: true, items: clean });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
