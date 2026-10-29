const { Pool } = require('pg');
require('dotenv').config();

const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL manquant dans .env');
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  },
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 20000
});

pool.on('error', (err) => {
  console.error('Erreur inattendue sur client Postgres', err);
});

async function query(text, params) {
  const client = await pool.connect();
  try {
    const res = await client.query(text, params);
    return res;
  } finally {
    client.release();
  }
}

async function initDb() {
  await query(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS series (
      k TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      short TEXT,
      type TEXT NOT NULL,
      lang TEXT,
      genres TEXT,
      price INTEGER NOT NULL DEFAULT 0,
      old INTEGER DEFAULT 0,
      stock INTEGER DEFAULT 99,
      vols TEXT,
      style TEXT,
      a TEXT,
      b TEXT,
      label TEXT,
      feat BOOLEAN DEFAULT FALSE,
      img TEXT,
      art TEXT,
      author TEXT,
      description TEXT,
      active BOOLEAN DEFAULT TRUE,
      sort_order INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS soon (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      a TEXT,
      b TEXT,
      style TEXT,
      img TEXT,
      sort_order INTEGER DEFAULT 0,
      active BOOLEAN DEFAULT TRUE
    );

    CREATE TABLE IF NOT EXISTS hero (
      id SERIAL PRIMARY KEY,
      item_id TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      ref TEXT,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      wilaya TEXT NOT NULL,
      com TEXT DEFAULT '',
      addr TEXT,
      ship_method TEXT NOT NULL,
      ship_cost INTEGER NOT NULL,
      sub_total INTEGER NOT NULL,
      total INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'new',
      notes TEXT,
      wa_url TEXT,
      lines TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS uploads (
      id TEXT PRIMARY KEY,
      original_name TEXT,
      filename TEXT NOT NULL,
      mime_type TEXT,
      size INTEGER,
      url TEXT NOT NULL,
      public_id TEXT,
      resource_type TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE OR REPLACE FUNCTION update_updated_at_column()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_series_updated_at') THEN
        CREATE TRIGGER update_series_updated_at
          BEFORE UPDATE ON series
          FOR EACH ROW
          EXECUTE FUNCTION update_updated_at_column();
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_orders_updated_at') THEN
        CREATE TRIGGER update_orders_updated_at
          BEFORE UPDATE ON orders
          FOR EACH ROW
          EXECUTE FUNCTION update_updated_at_column();
      END IF;
    END
    $$;
  `);
  await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS com TEXT DEFAULT ''`);
  await query(`ALTER TABLE series ADD COLUMN IF NOT EXISTS stock INTEGER DEFAULT 99`);
  await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS stock_done BOOLEAN DEFAULT FALSE`);
  await query(`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS data BYTEA`);
  await query(`ALTER TABLE series ADD COLUMN IF NOT EXISTS notified_oos BOOLEAN DEFAULT FALSE`);
  await query(`
    CREATE TABLE IF NOT EXISTS stock_movements (
      id BIGSERIAL PRIMARY KEY,
      k TEXT NOT NULL,
      name TEXT DEFAULT '',
      delta INTEGER NOT NULL,
      stock_after INTEGER NOT NULL,
      reason TEXT DEFAULT '',
      ref TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_stock_movements_k ON stock_movements(k);
    CREATE INDEX IF NOT EXISTS idx_stock_movements_created ON stock_movements(created_at DESC);
  `);
  await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS carrier TEXT`);
  await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking TEXT`);
  await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_status TEXT`);
  await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS label_url TEXT`);
}

function safeParse(v, fallback) {
  try {
    if (v === null || v === undefined) return fallback;
    if (typeof v === 'object') return v;
    return JSON.parse(v);
  } catch (e) {
    return fallback;
  }
}

function safeStringify(v) {
  try {
    return JSON.stringify(v);
  } catch (e) {
    return '[]';
  }
}

const defaults = {
  store_name: 'raystore',
  store_whatsapp: '213000000000',
  store_instagram: 'https://www.instagram.com/',
  ship_home: 600,   // tarif de base domicile depuis Alger, DA — barème Yalidine public
  ship_stopdesk: 500, // tarif de base stopdesk depuis Alger, DA — barème Yalidine public
  homesec_promo: 1,
  homesec_manga: 1,
  homesec_manhwa: 1,
  homesec_novel: 1,
  homesec_goods: 1,
  admin_password_hash: null,
  jwt_secret: process.env.JWT_SECRET || 'raystore-super-secret-change-this'
};

async function getSetting(key, fallback = null) {
  const res = await query('SELECT value FROM settings WHERE key = $1', [key]);
  if (res.rows.length === 0) {
    return fallback ?? defaults[key] ?? null;
  }
  const v = res.rows[0].value;
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+$/.test(v)) return parseInt(v, 10);
  return v;
}

async function setSetting(key, value) {
  const val = typeof value === 'boolean' ? (value ? 'true' : 'false') : (value === null || value === undefined ? '' : String(value));
  await query(`INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value`, [key, val]);
}

async function initDefaults() {
  for (const [k, v] of Object.entries(defaults)) {
    const existing = await getSetting(k, '__missing__');
    if (existing === '__missing__') {
      await setSetting(k, v);
    }
  }
}

const ready = initDb().then(initDefaults).catch((err) => {
  console.error('Erreur initialisation DB Neon:', err);
});

module.exports = { query, pool, getSetting, setSetting, safeParse, safeStringify, ready };
