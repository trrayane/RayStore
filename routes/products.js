const express = require('express');
const { query, pool, safeParse, safeStringify } = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

const BOOKS = ['manga', 'manhwa', 'novel', 'comics'];
const GOODS = ['figurine', 'poster', 'apparel', 'accessory', 'cards', 'deco', 'plush', 'mug', 'sticker', 'jewelry', 'stationery', 'bag', 'phonecase'];
const TYPES = [...BOOKS, ...GOODS];
const DEMOS = ['shonen', 'seinen', 'shojo', 'josei', 'isekai'];
const GENRES = ['action', 'fantasy', 'romance', 'drama', 'horror', 'mystery', 'scifi', 'comedy', 'sport'];

function normSeries(s = {}) {
  const hex = (c) => (/^#[0-9a-f]{6}$/i.test(c) ? c : '#5b3b7a');
  const type = TYPES.includes(s.type) ? s.type : 'manga';
  const isGood = GOODS.includes(type);
  const lang = isGood ? '' : ['en', 'fr', 'ar'].includes(s.lang) ? s.lang : 'fr';
  const genresArr = Array.isArray(s.genres) ? s.genres : [];
  const genres = isGood ? [] : genresArr.filter((g) => DEMOS.includes(g) || GENRES.includes(g));
  const volsArr = Array.isArray(s.vols) ? s.vols : [];
  const vols = volsArr.map((n) => Number(n)).filter((n) => n > 0);
  const price = Math.max(0, Number(s.price) || 0);
  const oldv = Number(s.old) > price ? Number(s.old) : 0;
  const style = TYPES.includes(s.style) ? s.style : type;
  return {
    k: String(s.k || '').trim(),
    name: String(s.name || '').trim(),
    short: s.short || '',
    type,
    lang,
    genres,
    vols,
    price,
    old: oldv,
    style,
    a: hex(s.a),
    b: hex(s.b),
    label: s.label === 'book' ? 'book' : '',
    feat: !!s.feat,
    img: s.img || '',
    art: s.art || '',
    author: s.author || '',
    desc: s.desc || '',
    stock: (s.stock == null || s.stock === '') ? 99 : Math.max(0, Math.floor(Number(s.stock) || 0)),
    active: s.active === false ? false : true,
    sort_order: Number(s.sort_order) || 0
  };
}

router.get('/', async (req, res) => {
  const result = await query(`SELECT k,name,short,type,lang,genres,price,old,stock,vols,style,a,b,label,feat,img,art,author,description,active,sort_order FROM series WHERE active=TRUE ORDER BY sort_order DESC, updated_at DESC, k ASC`);
  res.json(result.rows.map((r) => ({ ...r, genres: safeParse(r.genres, []), vols: safeParse(r.vols, []), feat: !!r.feat, active: !!r.active, desc: r.description || '' })));
});

router.get('/all', authRequired, async (req, res) => {
  const result = await query(`SELECT k,name,short,type,lang,genres,price,old,stock,vols,style,a,b,label,feat,img,art,author,description,active,sort_order FROM series ORDER BY sort_order DESC, updated_at DESC, k ASC`);
  res.json(result.rows.map((r) => ({ ...r, genres: safeParse(r.genres, []), vols: safeParse(r.vols, []), feat: !!r.feat, active: !!r.active, desc: r.description || '' })));
});

router.post('/', authRequired, async (req, res) => {
  const n = normSeries(req.body || {});
  if (!n.k || !n.name) return res.status(400).json({ error: 'Clé (k) et nom requis' });
  const exists = await query('SELECT k FROM series WHERE k=$1', [n.k]);
  if (exists.rows.length > 0) return res.status(409).json({ error: 'Cette clé existe déjà' });
  await query(
    `INSERT INTO series (k,name,short,type,lang,genres,price,old,stock,vols,style,a,b,label,feat,img,art,author,description,active,sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
    [n.k, n.name, n.short, n.type, n.lang, safeStringify(n.genres), n.price, n.old, n.stock, safeStringify(n.vols), n.style, n.a, n.b, n.label, n.feat, n.img, n.art, n.author, n.desc, n.active, n.sort_order]
  );
  res.status(201).json({ success: true });
});

router.put('/replace', authRequired, async (req, res) => {
  const list = Array.isArray(req.body && req.body.series) ? req.body.series : [];
  const clean = list.map((s) => normSeries(s)).filter((s) => s.k && s.name);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM series');
    for (const n of clean) {
      await client.query(
        `INSERT INTO series (k,name,short,type,lang,genres,price,old,stock,vols,style,a,b,label,feat,img,art,author,description,active,sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
        [n.k, n.name, n.short, n.type, n.lang, safeStringify(n.genres), n.price, n.old, n.stock, safeStringify(n.vols), n.style, n.a, n.b, n.label, n.feat, n.img, n.art, n.author, n.desc, n.active, n.sort_order]
      );
    }
    await client.query('COMMIT');
    res.json({ success: true, count: clean.length });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.put('/:k', authRequired, async (req, res) => {
  const k = String(req.params.k || '').trim();
  if (!k) return res.status(400).json({ error: 'Clé requise' });
  const exists = await query('SELECT k FROM series WHERE k=$1', [k]);
  if (exists.rows.length === 0) return res.status(404).json({ error: 'Introuvable' });
  const n = normSeries({ ...req.body, k });
  await query(
    `UPDATE series SET name=$1,short=$2,type=$3,lang=$4,genres=$5,price=$6,old=$7,stock=$8,vols=$9,style=$10,a=$11,b=$12,label=$13,feat=$14,img=$15,art=$16,author=$17,description=$18,active=$19,sort_order=$20 WHERE k=$21`,
    [n.name, n.short, n.type, n.lang, safeStringify(n.genres), n.price, n.old, n.stock, safeStringify(n.vols), n.style, n.a, n.b, n.label, n.feat, n.img, n.art, n.author, n.desc, n.active, n.sort_order, k]
  );
  res.json({ success: true });
});

router.delete('/:k', authRequired, async (req, res) => {
  const k = String(req.params.k || '').trim();
  if (!k) return res.status(400).json({ error: 'Clé requise' });
  await query('DELETE FROM series WHERE k=$1', [k]);
  res.json({ success: true });
});

module.exports = router;
