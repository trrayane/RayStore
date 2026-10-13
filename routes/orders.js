const express = require('express');
const { query, safeParse, safeStringify } = require('../db');
const { generateRef, generateId } = require('../utils');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

function buildWaUrl({ ref, storeWhatsapp, name, phone, wilaya, addr, shipMethod, shipCost, subTotal, total, lines }) {
  const fmt = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f') + '\u00a0DA';
  const lineStr = lines.map((l) => `• ${l.title} ×${l.qty} = ${fmt(l.price * l.qty)}`).join('\n');
  const shipLabel = shipMethod === 'home' ? 'Livraison à domicile' : 'Point relais (stopdesk)';
  const msg = `Nouvelle commande — ${ref}\n\n${lineStr}\n\nProduits : ${fmt(subTotal)}\nLivraison : ${shipLabel} (${fmt(shipCost)})\nTotal : ${fmt(total)}\n\nNom : ${name}\nTéléphone : ${phone}\nWilaya : ${wilaya}${addr ? `\nAdresse : ${addr}` : ''}`;
  const waNum = String(storeWhatsapp || '213000000000').replace(/\D/g, '');
  return `https://wa.me/${waNum}?text=${encodeURIComponent(msg)}`;
}

router.get('/', authRequired, async (req, res) => {
  const result = await query(`SELECT id, ref, name, phone, wilaya, addr, ship_method, ship_cost, sub_total, total, status, notes, wa_url, lines, created_at, updated_at FROM orders ORDER BY created_at DESC`);
  res.json(result.rows.map((r) => ({ ...r, ship_cost: Number(r.ship_cost), sub_total: Number(r.sub_total), total: Number(r.total), lines: safeParse(r.lines, []) })));
});

router.get('/stats', authRequired, async (req, res) => {
  const total = (await query('SELECT COUNT(*) as c FROM orders')).rows[0].c || 0;
  const newc = (await query("SELECT COUNT(*) as c FROM orders WHERE status='new'")).rows[0].c || 0;
  const conf = (await query("SELECT COUNT(*) as c FROM orders WHERE status='confirmed'")).rows[0].c || 0;
  const ship = (await query("SELECT COUNT(*) as c FROM orders WHERE status='shipped'")).rows[0].c || 0;
  const deliv = (await query("SELECT COUNT(*) as c FROM orders WHERE status='delivered'")).rows[0].c || 0;
  const canc = (await query("SELECT COUNT(*) as c FROM orders WHERE status='cancelled'")).rows[0].c || 0;
  const revRow = (await query("SELECT COALESCE(SUM(total),0) as s FROM orders WHERE status IN ('confirmed','shipped','delivered')")).rows[0];
  const todayRow = (await query("SELECT COALESCE(SUM(total),0) as s FROM orders WHERE date(created_at)=date('now') AND status!='cancelled'")).rows[0];
  res.json({ total, new: newc, confirmed: conf, shipped: ship, delivered: deliv, cancelled: canc, revenue: Number(revRow.s)||0, today: Number(todayRow.s)||0 });
});

router.post('/', async (req, res) => {
  const body = req.body || {};
  const { name, phone, wilaya, addr, shipMethod, shipCost, subTotal, total, lines, storeWhatsapp } = body;
  if (!name || !phone || !wilaya || !shipMethod || !Array.isArray(lines) || !lines.length) return res.status(400).json({ error: 'Données incomplètes' });
  const id = generateId();
  const ref = body.ref || generateRef();
  const cleanLines = lines.map((l) => ({ id: l.id, title: String(l.title || ''), qty: Math.max(1, Number(l.qty)||1), price: Math.max(0, Number(l.price)||0) }));
  const sc = Math.max(0, Number(shipCost)||0);
  const st = Math.max(0, Number(subTotal)||0);
  const tt = Math.max(0, Number(total)||st+sc);
  const wa = buildWaUrl({ ref, storeWhatsapp, name, phone, wilaya, addr: addr||'', shipMethod, shipCost: sc, subTotal: st, total: tt, lines: cleanLines });
  await query(
    `INSERT INTO orders (id,ref,name,phone,wilaya,addr,ship_method,ship_cost,sub_total,total,status,wa_url,lines) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'new',$11,$12)`,
    [id, ref, name, phone, String(wilaya), addr||'', shipMethod, sc, st, tt, wa, safeStringify(cleanLines)]
  );
  res.status(201).json({ success: true, id, ref, wa_url: wa });
});

router.patch('/:id/status', authRequired, async (req, res) => {
  const id = String(req.params.id||'');
  if (!id) return res.status(400).json({ error: 'ID requis' });
  const { status, notes } = req.body || {};
  const allowed = ['new','confirmed','shipped','delivered','cancelled'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Statut invalide' });
  const exists = await query('SELECT id FROM orders WHERE id=$1', [id]);
  if (exists.rows.length === 0) return res.status(404).json({ error: 'Commande introuvable' });
  await query('UPDATE orders SET status=$1, notes=$2 WHERE id=$3', [status, notes||'', id]);
  res.json({ success: true });
});

router.delete('/:id', authRequired, async (req, res) => {
  const id = String(req.params.id||'');
  if (!id) return res.status(400).json({ error: 'ID requis' });
  await query('DELETE FROM orders WHERE id=$1', [id]);
  res.json({ success: true });
});

module.exports = router;
