const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getSetting, setSetting } = require('../db');

const router = express.Router();

router.post('/login', async (req, res) => {
  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: 'Mot de passe requis' });
  let hash = await getSetting('admin_password_hash');
  const plainDefault = await getSetting('admin_password_plain') || '1234';
  if (!hash) {
    hash = await bcrypt.hash(String(plainDefault), 10);
    await setSetting('admin_password_hash', hash);
  }
  const ok = await bcrypt.compare(String(password), hash);
  if (!ok) return res.status(401).json({ error: 'Mot de passe incorrect' });
  const secret = await getSetting('jwt_secret');
  const token = jwt.sign({ role: 'admin' }, secret, { expiresIn: '7d' });
  res.json({ token });
});

router.post('/change-password', async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Ancien et nouveau mot de passe requis' });
  if (String(newPassword).length < 4) return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 4 caractères' });
  let hash = await getSetting('admin_password_hash');
  if (!hash) {
    const plainDefault = await getSetting('admin_password_plain') || '1234';
    hash = await bcrypt.hash(String(plainDefault), 10);
    await setSetting('admin_password_hash', hash);
  }
  const ok = await bcrypt.compare(String(currentPassword), hash);
  if (!ok) return res.status(401).json({ error: 'Mot de passe actuel incorrect' });
  const newHash = await bcrypt.hash(String(newPassword), 10);
  await setSetting('admin_password_hash', newHash);
  await setSetting('admin_password_plain', String(newPassword));
  res.json({ success: true });
});

router.get('/me', async (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.json({ authenticated: false });
  try {
    const secret = await getSetting('jwt_secret');
    jwt.verify(token, secret);
    return res.json({ authenticated: true, role: 'admin' });
  } catch (err) {
    return res.json({ authenticated: false });
  }
});

module.exports = router;
