const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const productsRoutes = require('./routes/products');
const soonRoutes = require('./routes/soon');
const heroRoutes = require('./routes/hero');
const settingsRoutes = require('./routes/settings');
const ordersRoutes = require('./routes/orders');
const uploadRoutes = require('./routes/upload');
const exportRoutes = require('./routes/export');
const { ready: dbReady } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use('/api/auth', authRoutes);
app.use('/api/products', productsRoutes);
app.use('/api/soon', soonRoutes);
app.use('/api/hero', heroRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/orders', ordersRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/export', exportRoutes);

app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

app.use(express.static(path.join(__dirname), { index: 'index.html' }));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) return next();
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Erreur serveur' });
});

dbReady.then(() => {
  if (require.main === module) {
    app.listen(PORT, () => {
      console.log(`✅ Raystore backend lancé sur http://localhost:${PORT}`);
    });
  }
});

module.exports = app;
