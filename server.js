const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const productsRoutes = require('./routes/products');
const soonRoutes = require('./routes/soon');
const heroRoutes = require('./routes/hero');
const settingsRoutes = require('./routes/settings');
const ordersRoutes = require('./routes/orders');
const uploadRoutes = require('./routes/upload');
const exportRoutes = require('./routes/export');
const { ready: dbReady, query } = require('./db');

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

const PUBLIC = process.env.PUBLIC_URL || 'https://raystore-black.vercel.app';
const LANGFR = { fr: 'Français', en: 'Anglais', ar: 'Arabe' };
const BOOKS = ['manga', 'manhwa', 'novel', 'comics'];
const DEFAULT_SEO = {
  title: 'raystore — Manga, comics, goodies et plus',
  desc: 'RayStore — mangas, comics et goodies en Algérie. Paiement à la livraison, livraison rapide partout en Algérie.',
  url: PUBLIC + '/',
  img: PUBLIC + '/p/img09.jpg',
  ld: { '@context': 'https://schema.org', '@type': 'WebSite', name: 'RayStore', url: PUBLIC + '/' }
};
let seoCache = null;

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function seoBlock(o) {
  const p = [];
  p.push('<meta name="description" content="' + esc(o.desc) + '">');
  p.push('<meta property="og:site_name" content="RayStore">');
  p.push('<meta property="og:type" content="' + (o.type || 'website') + '">');
  p.push('<meta property="og:title" content="' + esc(o.title) + '">');
  p.push('<meta property="og:description" content="' + esc(o.desc) + '">');
  p.push('<meta property="og:url" content="' + esc(o.url) + '">');
  if (o.img) p.push('<meta property="og:image" content="' + esc(o.img) + '">');
  p.push('<meta name="twitter:card" content="summary_large_image">');
  p.push('<link rel="canonical" href="' + esc(o.url) + '">');
  if (o.noindex) p.push('<meta name="robots" content="noindex">');
  if (o.ld) p.push('<script type="application/ld+json">' + JSON.stringify(o.ld).replace(/</g, '\\u003c') + '</script>');
  return '<!--SEO-START-->\n' + p.join('\n') + '\n<!--SEO-END-->';
}

async function buildSeo(req) {
  const url = PUBLIC + req.path + (req.search || '');
  const m = /^\/p\/([^/]+)$/.exec(req.path);
  if (m) {
    const id = decodeURIComponent(m[1]);
    const dash = id.lastIndexOf('-');
    const k = dash > 0 ? id.slice(0, dash) : id;
    const vol = dash > 0 ? parseInt(id.slice(dash + 1), 10) : 0;
    const r = await query(
      'SELECT k,name,type,lang,author,description,img,stock,price FROM series WHERE k=$1 AND active=TRUE',
      [k]
    );
    if (r.rows.length) {
      const s = r.rows[0];
      const isBook = BOOKS.indexOf(s.type) >= 0;
      const base = isBook
        ? s.name + (s.type === 'manga' && LANGFR[s.lang] ? ' ' + LANGFR[s.lang] : '') + (vol ? ' — Tome ' + vol : '')
        : s.name;
      const st = Math.max(0, Number(s.stock) || 0);
      const price = (Number(s.price) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
      const syn = String(s.description || '').replace(/\s+/g, ' ').trim();
      const desc = (syn ? syn + ' — ' : '') + 'Prix : ' + price + ' DA · ' +
        (st > 0 ? 'En stock (' + st + ' exemplaires)' : 'Épuisé') +
        '. Paiement à la livraison en Algérie, livraison rapide.';
      let img = String(s.img || '');
      if (img.charAt(0) === '/') img = PUBLIC + img;
      if (!/^https?:\/\//.test(img)) img = '';
      const ld = {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: base,
        sku: id,
        url: url,
        description: desc,
        brand: { '@type': 'Organization', name: 'RayStore' },
        offers: {
          '@type': 'Offer',
          price: Number(s.price) || 0,
          priceCurrency: 'DZD',
          availability: st > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
          url: url
        }
      };
      if (img) ld.image = [img];
      if (s.author) ld.author = { '@type': 'Person', name: s.author };
      return { title: base + ' | RayStore', desc: desc, url: url, img: img, ld: ld, type: 'product' };
    }
  }
  if (req.path === '/admin' || req.path.indexOf('/admin/') === 0) {
    return { title: 'Admin — RayStore', desc: 'Administration RayStore', url: url, noindex: true };
  }
  if (req.path === '/catalogue') {
    return Object.assign({}, DEFAULT_SEO, {
      title: 'Catalogue — RayStore',
      desc: 'Parcourez tous les mangas, manhwa, comics et goodies disponibles chez RayStore. Livraison rapide partout en Algérie.',
      url: url, img: ''
    });
  }
  if (req.path === '/cart' || req.path === '/checkout' || req.path === '/favorites') {
    return Object.assign({}, DEFAULT_SEO, {
      title: req.path === '/cart' ? 'Panier' : req.path === '/checkout' ? 'Commander' : 'Favoris' + ' — RayStore',
      url: url, img: ''
    });
  }
  return DEFAULT_SEO;
}

app.get('*', async (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) return next();
  try {
    if (!seoCache) seoCache = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
    const seo = await buildSeo(req);
    const html = seoCache
      .replace(/<!--SEO-START-->[\s\S]*?<!--SEO-END-->/, () => seoBlock(seo))
      .replace(/<title>[\s\S]*?<\/title>/, () => '<title>' + esc(seo.title) + '</title>');
    res.status(200).type('html').send(html);
  } catch (e) {
    console.error('[seo]', e.message);
    res.sendFile(path.join(__dirname, 'index.html'), (err) => { if (err) next(); });
  }
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
