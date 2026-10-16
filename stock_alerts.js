const { query, safeParse } = require('./db');
const { notifyStock } = require('./telegram');

const PUBLIC = process.env.PUBLIC_URL || 'https://raystore-black.vercel.app';

async function checkStockAlert(k) {
  k = String(k || '');
  if (!k) return null;
  try {
    const r = await query('SELECT k,name,stock,notified_oos,vols FROM series WHERE k=$1', [k]);
    if (!r.rows.length) return null;
    const s = r.rows[0];
    const stock = Math.max(0, Number(s.stock) || 0);
    const vols = safeParse(s.vols, []);
    const v0 = (Array.isArray(vols) && vols.length && Number(vols[0])) || 0;
    const url = PUBLIC + '/p/' + k + '-' + (v0 || 1);
    if (stock <= 0 && !s.notified_oos) {
      const sent = await notifyStock({ kind: 'oos', name: s.name, stock: stock, url: url });
      if (sent) await query('UPDATE series SET notified_oos=TRUE WHERE k=$1', [k]);
      return sent ? 'oos' : null;
    }
    if (stock > 0 && s.notified_oos) {
      const sent = await notifyStock({ kind: 'restock', name: s.name, stock: stock, url: url });
      if (sent) await query('UPDATE series SET notified_oos=FALSE WHERE k=$1', [k]);
      return sent ? 'restock' : null;
    }
    return null;
  } catch (e) {
    console.error('[stock-alert]', k, e.message);
    return null;
  }
}

async function checkStockAlerts(keys) {
  const out = [];
  const list = Array.isArray(keys) ? keys : [];
  for (const k of new Set(list)) {
    const r = await checkStockAlert(k);
    if (r) out.push(k + ':' + r);
  }
  return out;
}

module.exports = { checkStockAlert, checkStockAlerts };
