const express = require('express');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const cloudinary = require('cloudinary').v2;
const { query } = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|webp|avif|gif|svg/;
    const ext = path.extname(file.originalname).toLowerCase();
    const mime = file.mimetype.toLowerCase();
    if (allowed.test(ext) && allowed.test(mime)) return cb(null, true);
    cb(new Error("Format d'image non autorisé (JPG, PNG, WebP, AVIF, GIF, SVG)"));
  }
});

router.post('/', authRequired, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Aucun fichier envoyé' });
    const id = uuidv4();
    const ext = path.extname(req.file.originalname).toLowerCase() || '.webp';
    const base = path.basename(req.file.originalname, ext).replace(/[^a-zA-Z0-9-_]/g, '-');
    const isSvg = req.file.mimetype.toLowerCase() === 'image/svg+xml' || ext === '.svg';
    const uploadResult = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: 'raystore',
          public_id: `${Date.now()}-${base}-${id.slice(0, 8)}`,
          resource_type: isSvg ? 'raw' : 'image',
          transformation: isSvg ? undefined : [{ quality: 'auto:best', fetch_format: 'auto' }, { width: 1600, height: 2400, crop: 'limit' }]
        },
        (error, result) => (error ? reject(error) : resolve(result))
      );
      stream.end(req.file.buffer);
    });
    await query(
      `INSERT INTO uploads (id, original_name, filename, mime_type, size, url, public_id, resource_type) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        id,
        req.file.originalname,
        uploadResult.original_filename || `${base}${ext}`,
        req.file.mimetype,
        uploadResult.bytes || req.file.size,
        uploadResult.secure_url,
        uploadResult.public_id,
        uploadResult.resource_type
      ]
    );
    res.json({ id, url: uploadResult.secure_url, filename: uploadResult.original_filename, size: uploadResult.bytes || req.file.size, public_id: uploadResult.public_id });
  } catch (err) {
    console.error('Upload Cloudinary error:', err);
    res.status(500).json({ error: err.message || "Erreur lors de l'upload" });
  }
});

router.get('/', authRequired, async (req, res) => {
  const result = await query('SELECT id, original_name, filename, mime_type, size, url, public_id, resource_type, created_at FROM uploads ORDER BY created_at DESC');
  res.json(result.rows);
});

router.delete('/:id', authRequired, async (req, res) => {
  const { id } = req.params;
  const result = await query('SELECT public_id, resource_type FROM uploads WHERE id=$1', [id]);
  if (result.rows.length === 0) return res.status(404).json({ error: 'Upload introuvable' });
  const row = result.rows[0];
  try {
    if (row.public_id) await cloudinary.uploader.destroy(row.public_id, { resource_type: row.resource_type === 'raw' ? 'raw' : 'image' });
  } catch (e) {}
  await query('DELETE FROM uploads WHERE id=$1', [id]);
  res.json({ success: true });
});

module.exports = router;
