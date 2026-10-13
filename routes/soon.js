const express = require('express');
const { query } = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

function normSoon(s = {}) {
  const hex = (c) => (/^#[0-9a-f]{6}$/i.test(c) ? c : '#5b3b7a');
  return {
    name: String(s.name || '').trim(),
    a: hex(s.a),
    b: hex(s.b),
    style: ['manga', 'manhwa', 'novel', 'comics'].includes(s.style) ? s.style : 'manga',
    img: s.img || '',
    sort_order: Number(s.sort_order) || 0,
    active: s.active === false ? false : true
  };
}

router.get('/', async (req, res) => {
  const result = await query('SELECT id,name,a,b,style,img,sort_order,active FROM soon WHERE active=TRUE ORDER BY sort_order ASC, id ASC');
  res.json(result.rows.map((r) => ({ ...r, active: !!r.active })));
});

router.get('/all', authRequired, async (req, res) => {
  const result = await query('SELECT id,name,a,b,style,img,sort_order,active FROM soon ORDER BY sort_order ASC, id ASC');
  res.json(result.rows.map((r) => ({ ...r, active: !!r.active })));
});

router.post('/', authRequired, async (req, res) => {
  const n = normSoon(req.body || {});
  if (!n.name) return res.status(400).json({ error: 'Nom requis' });
  await query('INSERT INTO soon (name,a,b,style,img,sort_order,active) VALUES ($1,$2,$3,$4,$5,$6,$7)', [n.name, n.a, n.b, n.style, n.img, n.sort_order, n.active]);
  res.status(201).json({ success: true });
});

router.put('/:id', authRequired, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID invalide' });
  const exists = await query('SELECT id FROM soon WHERE id=$1', [id]);
  if (exists.rows.length === 0) return res.status(404).json({ error: 'Introuvable' });
  const n = normSoon(req.body || {});
  await query('UPDATE soon SET name=$1,a=$2,b=$3,style=$4,img=$5,sort_order=$6,active=$7 WHERE id=$8', [n.name, n.a, n.b, n.style, n.img, n.sort_order, n.active, id]);
  res.json({ success: true });
});

router.delete('/:id', authRequired, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID invalide' });
  await query('DELETE FROM soon WHERE id=$1', [id]);
  res.json({ success: true });
});

module.exports = router;
