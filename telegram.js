const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const CHAT = String(process.env.TELEGRAM_CHAT_ID || '').trim();

const tgUrl = (m) => `https://api.telegram.org/bot${TOKEN}/${m}`;
const h = (s) => String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const fmt = (n) => String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f') + '\u00a0DA';

async function call(method, payload) {
  const res = await fetch(tgUrl(method), {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload)
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* réponse non JSON */ }
  if (!res.ok || !data || data.ok !== true) {
    throw new Error(`Telegram ${method} : ${data && data.description ? data.description : 'HTTP ' + res.status}`);
  }
  return data.result;
}

function fmtDate(d) {
  const x = d ? new Date(d) : new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${p(x.getDate())}/${p(x.getMonth() + 1)}/${x.getFullYear()} ${p(x.getHours())}:${p(x.getMinutes())}`;
}

function buildText(o) {
  const shipLabel = o.shipMethod === 'home' ? 'Livraison \u00e0 domicile' : 'Point relais (stopdesk)';
  const parts = [];
  parts.push(`\ud83d\uded2 <b>NOUVELLE COMMANDE</b> \u2014 <b>${h(o.ref)}</b>`);
  parts.push(`<i>${fmtDate(o.created)}</i>`);
  parts.push('');
  parts.push(`\ud83d\udc64 <b>Client</b> : ${h(o.name)}`);
  parts.push(`\ud83d\udcde <b>T\u00e9l\u00e9phone</b> : ${h(o.phone)}`);
  parts.push(`\ud83d\udccd <b>Wilaya</b> : ${h(o.wilaya)}`);
  if (o.com) parts.push(`\ud83c\udfda <b>Commune</b> : ${h(o.com)}`);
  if (o.addr) parts.push(`\ud83c\udfe0 <b>Adresse</b> : ${h(o.addr)}`);
  parts.push(`\ud83d\ude9a <b>Livraison</b> : ${shipLabel} \u2014 ${fmt(o.shipCost)}`);
  if (o.notes) parts.push(`\ud83d\udcdd <b>Note client</b> : ${h(o.notes)}`);
  parts.push('');
  parts.push(`\ud83d\udce6 <b>ARTICLES</b> (${o.lines.length})`);
  o.lines.forEach((l, i) => {
    parts.push(`${i + 1}. ${h(l.title)}`);
    parts.push(`   ${l.qty} \u00d7 ${fmt(l.price)} = <b>${fmt(l.price * l.qty)}</b>`);
  });
  parts.push('');
  parts.push(`\u2796 Sous-total : ${fmt(o.subTotal)}`);
  parts.push(`\ud83d\ude9a Livraison : ${fmt(o.shipCost)}`);
  parts.push(`\ud83d\udcb0 <b>TOTAL : ${fmt(o.total)}</b>`);
  return parts.join('\n');
}

function chunkText(text, max) {
  const lines = text.split('\n'), out = [];
  let cur = '';
  for (const ln of lines) {
    if ((cur + '\n' + ln).length > max && cur) { out.push(cur); cur = ln; }
    else cur = cur ? cur + '\n' + ln : ln;
  }
  if (cur) out.push(cur);
  return out;
}

async function sendPhoto(l) {
  const raw = `${l.title} \u00d7${l.qty} \u2014 ${fmt(l.price * l.qty)}`.slice(0, 900);
  const caption = h(raw);
  if (/^https?:\/\//i.test(l.img)) {
    await call('sendPhoto', { chat_id: CHAT, photo: l.img, caption, parse_mode: 'HTML' });
    return;
  }
  const m = /^data:image\/([a-z+.-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(l.img);
  if (!m) return;
  const bytes = Buffer.from(m[2].replace(/\s+/g, ''), 'base64');
  if (!bytes.length || bytes.length > 10 * 1024 * 1024) return;
  const ext = (m[1] === 'jpeg' ? 'jpg' : m[1] === 'svg+xml' ? 'svg' : m[1]).replace(/[^a-z0-9]/gi, '');
  const fd = new FormData();
  fd.append('chat_id', CHAT);
  fd.append('caption', caption);
  fd.append('parse_mode', 'HTML');
  fd.append('photo', new Blob([bytes], { type: 'image/' + m[1] }), `produit.${ext || 'png'}`);
  const res = await fetch(tgUrl('sendPhoto'), { method: 'POST', body: fd });
  let data = null;
  try { data = await res.json(); } catch (e) { /* ignoré */ }
  if (!res.ok || !data || data.ok !== true) {
    throw new Error(`Telegram sendPhoto (base64) : ${data && data.description ? data.description : 'HTTP ' + res.status}`);
  }
}

async function notifyNewOrder(order) {
  if (!TOKEN || !CHAT) {
    console.warn('[telegram] TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID manquants dans .env — notification non envoyée');
    return false;
  }
  try {
    for (const chunk of chunkText(buildText(order), 3900)) {
      await call('sendMessage', { chat_id: CHAT, text: chunk, parse_mode: 'HTML', disable_web_page_preview: true });
    }
    for (const l of order.lines || []) {
      if (!l.img) continue;
      try { await sendPhoto(l); } catch (e) { console.error('[telegram] photo non envoyée (' + l.title + ') :', e.message); }
    }
    return true;
  } catch (err) {
    console.error('[telegram] échec envoi de la commande', order.ref || '', ':', err.message);
    return false;
  }
}

module.exports = { notifyNewOrder };
