const express = require('express');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

/* Cache mémoire des images (évite une requête Postgres à chaque affichage d'image) */
const memCache = new Map();
const MEM_MAX = 120; // ~120 images gardées en RAM

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|webp|avif|gif|svg/;
    const ext = path.extname(file.originalname).toLowerCase();
    const mime = file.mimetype.toLowerCase();
    if (allowed.test(ext) && allowed.test(mime)) return cb(null, true);
    cb(new Error("Format d'image non autorisé (JPG, PNG, WebP, AVIF, GIF, SVG)"));
  }
});

function originOf(req) {
  const host = req.get('x-forwarded-host') || req.get('host') || 'localhost:' + (process.env.PORT || 3000);
  const proto = (req.get('x-forwarded-proto') || req.protocol || 'http').split(',')[0];
  return proto + '://' + host;
}

router.post('/', authRequired, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Aucun fichier envoyé' });
    const id = uuidv4();
    const ext = path.extname(req.file.originalname).toLowerCase() || '.jpg';
    const base = path.basename(req.file.originalname, ext).replace(/[^a-zA-Z0-9-_]/g, '-');
    const url = originOf(req) + '/api/upload/img/' + id;
    await query(
      `INSERT INTO uploads (id, original_name, filename, mime_type, size, url, public_id, resource_type, data) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        id,
        req.file.originalname,
        `${base}${ext}`,
        req.file.mimetype,
        req.file.size,
        url,
        null,
        'db',
        req.file.buffer
      ]
    );
    res.json({ id, url, filename: `${base}${ext}`, size: req.file.size, public_id: null });
  } catch (err) {
    console.error('Upload DB error:', err);
    res.status(500).json({ error: err.message || "Erreur lors de l'upload" });
  }
});

router.get('/img/:id', async (req, res) => {
  try {
    const id = String(req.params.id || '');
    if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(404).json({ error: 'Introuvable' });
    let row = memCache.get(id);
    if (!row) {
      const r = await query('SELECT mime_type, size, data FROM uploads WHERE id=$1', [id]);
      if (!r.rows.length || !r.rows[0].data) return res.status(404).json({ error: 'Image introuvable' });
      row = r.rows[0];
      if (memCache.size >= MEM_MAX) {
        memCache.delete(memCache.keys().next().value);
      }
      memCache.set(id, row);
    }
    res.set('Content-Type', row.mime_type || 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=31536000, s-maxage=31536000, immutable, stale-while-revalidate=2592000');
    res.send(Buffer.from(row.data));
  } catch (err) {
    console.error('Image GET error:', err);
    res.status(500).json({ error: err.message || 'Erreur serveur' });
  }
});

router.get('/', authRequired, async (req, res) => {
  const result = await query('SELECT id, original_name, filename, mime_type, size, url, public_id, resource_type, created_at FROM uploads ORDER BY created_at DESC');
  res.json(result.rows);
});

router.delete('/:id', authRequired, async (req, res) => {
  const { id } = req.params;
  const result = await query('SELECT id FROM uploads WHERE id=$1', [id]);
  if (result.rows.length === 0) return res.status(404).json({ error: 'Upload introuvable' });
  await query('DELETE FROM uploads WHERE id=$1', [id]);
  res.json({ success: true });
});

module.exports = router;
