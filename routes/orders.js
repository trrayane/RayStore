const express = require('express');
const { query, pool, safeParse, safeStringify } = require('../db');
const { generateRef, generateId } = require('../utils');
const { authRequired } = require('../middleware/auth');
const { notifyNewOrder } = require('../telegram');
const { checkStockAlerts } = require('../stock_alerts');
const { logMovement } = require('../stock_journal');
const carriers = require('../carriers');
const { rateLimit } = require('../middleware/ratelimit');

const router = express.Router();

const RESTORE = ['cancelled', 'returned'];
const isActive = (s) => !RESTORE.includes(String(s || 'new'));
const serKey = (l) => {
  const id = String((l && (l.k || l.id)) || '');
  if (!id) return '';
  return l && l.k ? id : id.slice(0, id.lastIndexOf('-'));
};
function aggLines(lines) {
  const need = new Map();
  for (const l of Array.isArray(lines) ? lines : []) {
    const k = serKey(l);
    if (!k) continue;
    const q = Math.max(1, Number(l.qty) || 1);
    need.set(k, (need.get(k) || 0) + q);
  }
  return need;
}

function buildWaUrl({ ref, storeWhatsapp, name, phone, wilaya, addr, shipMethod, shipCost, subTotal, total, lines }) {
  const fmt = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f') + '\u00a0DA';
  const lineStr = lines.map((l) => `• ${l.title} ×${l.qty} = ${fmt(l.price * l.qty)}`).join('\n');
  const shipLabel = shipMethod === 'home' ? 'Livraison à domicile' : 'Point relais (stopdesk)';
  const msg = `Nouvelle commande — ${ref}\n\n${lineStr}\n\nProduits : ${fmt(subTotal)}\nLivraison : ${shipLabel} (${fmt(shipCost)})\nTotal : ${fmt(total)}\n\nNom : ${name}\nTéléphone : ${phone}\nWilaya : ${wilaya}${addr ? `\nAdresse : ${addr}` : ''}`;
  const waNum = String(storeWhatsapp || '213000000000').replace(/\D/g, '');
  return `https://wa.me/${waNum}?text=${encodeURIComponent(msg)}`;
}

router.get('/', authRequired, async (req, res) => {
  const result = await query(`SELECT id, ref, name, phone, wilaya, com, addr, ship_method, ship_cost, sub_total, total, status, notes, wa_url, lines, carrier, tracking, tracking_status, label_url, created_at, updated_at FROM orders ORDER BY created_at DESC`);
  res.json(result.rows.map((r) => ({ ...r, ship_cost: Number(r.ship_cost), sub_total: Number(r.sub_total), total: Number(r.total), lines: safeParse(r.lines, []) })));
});

router.get('/stats', authRequired, async (req, res) => {
  const total = (await query('SELECT COUNT(*) as c FROM orders')).rows[0].c || 0;
  const newc = (await query("SELECT COUNT(*) as c FROM orders WHERE status='new'")).rows[0].c || 0;
  const conf = (await query("SELECT COUNT(*) as c FROM orders WHERE status='confirmed'")).rows[0].c || 0;
  const ship = (await query("SELECT COUNT(*) as c FROM orders WHERE status='shipped'")).rows[0].c || 0;
  const deliv = (await query("SELECT COUNT(*) as c FROM orders WHERE status='delivered'")).rows[0].c || 0;
  const canc = (await query("SELECT COUNT(*) as c FROM orders WHERE status='cancelled'")).rows[0].c || 0;
  const ret = (await query("SELECT COUNT(*) as c FROM orders WHERE status='returned'")).rows[0].c || 0;
  const revRow = (await query("SELECT COALESCE(SUM(total),0) as s FROM orders WHERE status IN ('confirmed','shipped','delivered')")).rows[0];
  const todayRow = (await query("SELECT COALESCE(SUM(total),0) as s FROM orders WHERE date(created_at)=date('now') AND status NOT IN ('cancelled','returned')")).rows[0];
  res.json({ total, new: newc, confirmed: conf, shipped: ship, delivered: deliv, cancelled: canc, returned: ret, revenue: Number(revRow.s)||0, today: Number(todayRow.s)||0 });
});

/* ---- Transporteurs (Yalidine / ZR Express) ---- */
function orderForParcel(o) {
  const wil = String(o.wilaya || '');
  const m = wil.match(/^(\d{1,2})\s*-\s*(.+)$/);
  const lines = safeParse(o.lines, []);
  const parts = String(o.name || '').trim().split(/\s+/);
  const firstname = parts[0] || 'Client';
  return {
    ref: String(o.ref || o.id),
    name: String(o.name || ''),
    firstname,
    familyname: parts.slice(1).join(' ') || firstname,
    phone: String(o.phone || ''),
    wilCode: m ? Number(m[1]) : 0,
    wilName: m ? m[2].trim() : wil,
    com: String(o.com || ''),
    addr: String(o.addr || ''),
    stopdesk: String(o.ship_method) === 'stopdesk',
    total: Number(o.total) || 0,
    summary: lines.map((l) => l.title + ' ×' + l.qty).join(' | ').slice(0, 250)
  };
}
async function loadParcelOrder(id) {
  const r = await query('SELECT id, ref, name, phone, wilaya, com, addr, ship_method, total, lines, carrier, tracking, tracking_status, label_url FROM orders WHERE id=$1', [id]);
  return r.rows.length ? r.rows[0] : null;
}

router.get('/carriers', authRequired, async (req, res) => {
  res.json(carriers.available());
});

router.post('/carriers/test', authRequired, async (req, res) => {
  try {
    const r = await carriers.testCarrier(String((req.body || {}).carrier || ''));
    res.json({ success: true, msg: r.msg });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get('/:id/tracking', authRequired, async (req, res) => {
  const o = await loadParcelOrder(String(req.params.id || ''));
  if (!o) return res.status(404).json({ error: 'Commande introuvable' });
  if (!o.carrier || !o.tracking) return res.status(404).json({ error: 'Aucun colis créé pour cette commande' });
  try {
    const t = await carriers.getTracking(o.carrier, o.tracking);
    await query('UPDATE orders SET tracking_status=$1 WHERE id=$2', [t.status, o.id]);
    res.json({ success: true, status: t.status, history: t.history || [] });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

router.post('/:id/label', authRequired, async (req, res) => {
  const o = await loadParcelOrder(String(req.params.id || ''));
  if (!o) return res.status(404).json({ error: 'Commande introuvable' });
  if (!o.carrier || !o.tracking) return res.status(404).json({ error: 'Aucun colis créé pour cette commande' });
  try {
    const url = await carriers.getLabel(o.carrier, o.tracking, o.label_url);
    if (!o.label_url) await query('UPDATE orders SET label_url=$1 WHERE id=$2', [url, o.id]);
    res.json({ success: true, url });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

router.post('/:id/parcel', authRequired, async (req, res) => {
  const body = req.body || {};
  const carrier = String(body.carrier || '');
  if (carrier !== 'yalidine' && carrier !== 'zr') return res.status(400).json({ error: 'Transporteur invalide' });
  const o = await loadParcelOrder(String(req.params.id || ''));
  if (!o) return res.status(404).json({ error: 'Commande introuvable' });
  if (o.tracking) return res.status(409).json({ error: 'Colis déjà créé', tracking: o.tracking });
  if (!carriers.available()[carrier === 'yalidine' ? 'yalidine' : 'zr']) {
    return res.status(400).json({ error: (carrier === 'yalidine' ? 'Yalidine' : 'ZR Express') + ' non configuré — ajoute les clés API dans .env puis redéploie.' });
  }
  const op = orderForParcel(o);
  try {
    if (op.stopdesk && body.stopdeskId === undefined) {
      const stops = await carriers.listStops(carrier, op);
      if (stops.length > 1) return res.json({ needStops: true, stops });
      if (stops.length === 1) return createAndSave(res, carrier, op, { stopdeskId: stops[0].id, hubId: stops[0].id }, o.id);
      return res.status(422).json({ error: 'Aucun point relais trouvé pour cette wilaya/commune' });
    }
    return createAndSave(res, carrier, op, { stopdeskId: body.stopdeskId, hubId: body.stopdeskId }, o.id);
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
});

async function createAndSave(res, carrier, op, opts, orderId) {
  try {
    const p = await carriers.createParcel(carrier, op, opts);
    await query('UPDATE orders SET carrier=$1, tracking=$2, tracking_status=$3, label_url=$4 WHERE id=$5',
      [carrier, p.tracking, p.status || '', p.label || '', orderId]);
    res.json({ success: true, carrier, tracking: p.tracking, status: p.status || '', label: p.label || '' });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}

router.post('/', rateLimit({ windowMs: 10 * 60 * 1000, max: 5, scale: 'cmd' }), async (req, res) => {
  const body = req.body || {};
  const { name, phone, wilaya, com, addr, shipMethod, shipCost, subTotal, total, lines, notes, storeWhatsapp } = body;
  if (!name || !phone || !wilaya || !shipMethod || !Array.isArray(lines) || !lines.length) return res.status(400).json({ error: 'Données incomplètes' });
  const id = generateId();
  const ref = body.ref || generateRef();
  const cleanLines = lines.map((l) => ({
    id: l.id,
    k: serKey(l),
    title: String(l.title || ''),
    qty: Math.max(1, Number(l.qty) || 1),
    price: Math.max(0, Number(l.price) || 0),
    img: String(l.img || '').slice(0, 2000000),
    style: String(l.style || ''),
    a: String(l.a || ''),
    b: String(l.b || ''),
    vol: l.vol == null ? '' : l.vol,
    short: String(l.short || ''),
    author: String(l.author || '')
  }));
  const sc = Math.max(0, Number(shipCost)||0);
  const st = Math.max(0, Number(subTotal)||0);
  const tt = Math.max(0, Number(total)||st+sc);
  const wa = buildWaUrl({ ref, storeWhatsapp, name, phone, wilaya, addr: addr||'', shipMethod, shipCost: sc, subTotal: st, total: tt, lines: cleanLines });
  let need = new Map();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query('SELECT id, ref, wa_url FROM orders WHERE ref=$1', [ref]);
    if (existing.rows.length) {
      await client.query('ROLLBACK');
      return res.json({ success: true, id: existing.rows[0].id, ref, wa_url: existing.rows[0].wa_url, duplicate: true });
    }
    need = aggLines(cleanLines);
    const bad = [];
    for (const [k, q] of need) {
      const r = await client.query('SELECT stock FROM series WHERE k=$1 FOR UPDATE', [k]);
      if (!r.rows.length) { bad.push(k); continue; }
      if ((Number(r.rows[0].stock) || 0) < q) bad.push(k);
    }
    if (bad.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Stock insuffisant ou produit indisponible', items: bad });
    }
    for (const [k, q] of need) {
      const up = await client.query('UPDATE series SET stock=stock-$1 WHERE k=$2 RETURNING stock, name', [q, k]);
      if (up.rows[0]) {
        await logMovement(client, { k, name: up.rows[0].name, delta: -q, stock_after: up.rows[0].stock, reason: 'Commande', ref });
      }
    }
    await client.query(
      `INSERT INTO orders (id,ref,name,phone,wilaya,com,addr,ship_method,ship_cost,sub_total,total,status,notes,wa_url,lines,stock_done) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'new',$12,$13,$14,TRUE)`,
      [id, ref, name, phone, String(wilaya), String(com||''), addr||'', shipMethod, sc, st, tt, String(notes||''), wa, safeStringify(cleanLines)]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    return res.status(500).json({ error: err.message || 'Erreur serveur' });
  } finally {
    client.release();
  }
  await Promise.all([
    notifyNewOrder({
      ref, name, phone, wilaya: String(wilaya), com: String(com||''), addr: addr||'',
      notes: String(notes||''), shipMethod, shipCost: sc, subTotal: st, total: tt,
      lines: cleanLines, created: new Date().toISOString()
    }).catch((e) => console.error('[telegram] :', e && e.message)),
    checkStockAlerts([...need.keys()])
  ]);
  res.status(201).json({ success: true, id, ref, wa_url: wa });
});

router.patch('/:id/status', authRequired, async (req, res) => {
  const id = String(req.params.id||'');
  if (!id) return res.status(400).json({ error: 'ID requis' });
  const { status, notes } = req.body || {};
  const allowed = ['new','confirmed','shipped','delivered','cancelled','returned'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Statut invalide' });
  const client = await pool.connect();
  let touched = [];
  try {
    await client.query('BEGIN');
    const exists = await client.query('SELECT id, ref, status, lines, stock_done FROM orders WHERE id=$1 FOR UPDATE', [id]);
    if (exists.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Commande introuvable' });
    }
    const row = exists.rows[0];
    const old = String(row.status || 'new');
    if (old !== status) {
      const restore = isActive(old) && RESTORE.includes(status);
      const consume = RESTORE.includes(old) && isActive(status);
      const done = row.stock_done === true;
      if (restore && done) {
        for (const [k, q] of aggLines(safeParse(row.lines, []))) {
          const up = await client.query('UPDATE series SET stock=stock+$1 WHERE k=$2 RETURNING stock, name', [q, k]);
          if (up.rows[0]) {
            await logMovement(client, { k, name: up.rows[0].name, delta: q, stock_after: up.rows[0].stock, reason: status === 'cancelled' ? 'Commande annulée' : 'Commande retournée', ref: row.ref });
          }
        }
        touched = [...aggLines(safeParse(row.lines, [])).keys()];
        await client.query('UPDATE orders SET stock_done=FALSE WHERE id=$1', [id]);
      } else if (consume && !done) {
        for (const [k, q] of aggLines(safeParse(row.lines, []))) {
          const before = await client.query('SELECT stock, name FROM series WHERE k=$1 FOR UPDATE', [k]);
          const oldSt = before.rows.length ? Number(before.rows[0].stock) || 0 : 0;
          await client.query('UPDATE series SET stock=GREATEST(stock-$1,0) WHERE k=$2', [q, k]);
          const after = await client.query('SELECT stock FROM series WHERE k=$1', [k]);
          const newSt = after.rows.length ? Number(after.rows[0].stock) || 0 : oldSt;
          if (before.rows.length) {
            await logMovement(client, { k, name: before.rows[0].name, delta: newSt - oldSt, stock_after: newSt, reason: 'Commande réactivée', ref: row.ref });
          }
        }
        touched = [...aggLines(safeParse(row.lines, [])).keys()];
        await client.query('UPDATE orders SET stock_done=TRUE WHERE id=$1', [id]);
      }
      await client.query('UPDATE orders SET status=$1, notes=$2 WHERE id=$3', [status, notes||'', id]);
    } else if (notes != null) {
      await client.query('UPDATE orders SET notes=$1 WHERE id=$2', [notes||'', id]);
    }
    await client.query('COMMIT');
    if (touched.length) await checkStockAlerts(touched);
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: err.message || 'Erreur serveur' });
  } finally {
    client.release();
  }
});

router.delete('/:id', authRequired, async (req, res) => {
  const id = String(req.params.id||'');
  if (!id) return res.status(400).json({ error: 'ID requis' });
  const client = await pool.connect();
  let touched = [];
  try {
    await client.query('BEGIN');
    const r = await client.query('SELECT lines, stock_done FROM orders WHERE id=$1 FOR UPDATE', [id]);
    if (r.rows.length && r.rows[0].stock_done === true) {
      for (const [k, q] of aggLines(safeParse(r.rows[0].lines, []))) {
        const up = await client.query('UPDATE series SET stock=stock+$1 WHERE k=$2 RETURNING stock, name', [q, k]);
        if (up.rows[0]) {
          await logMovement(client, { k, name: up.rows[0].name, delta: q, stock_after: up.rows[0].stock, reason: 'Suppression de commande', ref: id });
        }
      }
      touched = [...aggLines(safeParse(r.rows[0].lines, [])).keys()];
    }
    await client.query('DELETE FROM orders WHERE id=$1', [id]);
    await client.query('COMMIT');
    if (touched.length) await checkStockAlerts(touched);
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: err.message || 'Erreur serveur' });
  } finally {
    client.release();
  }
});

module.exports = router;
