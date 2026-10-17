const { getSetting, setSetting } = require('./db');

const YAL_BASE = 'https://api.yalidine.app/v1';
const ZR_BASE = 'https://api.zrexpress.app/api/v1';
const TIMEOUT = 15000;

function cfg() {
  return {
    yalId: String(process.env.YALIDINE_API_ID || '').trim(),
    yalTok: String(process.env.YALIDINE_API_TOKEN || '').trim(),
    yalFrom: String(process.env.YALIDINE_FROM_WILAYA || 'Alger').trim() || 'Alger',
    weight: Math.max(1, Number(process.env.YALIDINE_WEIGHT) || 1),
    zrKey: String(process.env.ZREXPRESS_API_KEY || process.env.ZR_API_KEY || '').trim(),
    zrTenant: String(process.env.ZREXPRESS_TENANT_ID || process.env.ZR_TENANT || '').trim()
  };
}

function available() {
  const c = cfg();
  return { yalidine: !!(c.yalId && c.yalTok), zr: !!(c.zrKey && c.zrTenant) };
}

const strip = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

function normPhoneLocal(p) {
  let x = String(p || '').replace(/\D/g, '');
  if (x.startsWith('00213')) x = x.slice(5);
  if (x.startsWith('213') && x.length > 3) x = '0' + x.slice(3);
  if (!x.startsWith('0')) x = '0' + x;
  return x;
}
function normPhoneZr(p) {
  let x = String(p || '').replace(/\D/g, '');
  if (x.startsWith('00213')) x = x.slice(5);
  if (x.startsWith('213')) x = x.slice(3);
  return '+213' + x;
}

async function http(method, url, opts) {
  const res = await fetch(url, Object.assign({ method, signal: AbortSignal.timeout(TIMEOUT) }, opts || {}));
  let data = null;
  const txt = await res.text();
  try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = txt; }
  return { status: res.status, ok: res.ok, data };
}

function errMsg(r) {
  const d = r.data;
  if (d && typeof d === 'object') {
    if (d.detail) return String(d.detail);
    if (d.title) return String(d.title) + (d.status ? ' (' + d.status + ')' : '');
    if (d.error && d.error.description) return String(d.error.description);
    if (d.error) return String(d.error);
    if (d.message) return String(d.message);
    if (Array.isArray(d.errors) && d.errors.length) return d.errors.map((e) => e.description || e.code || JSON.stringify(e)).join(' ; ');
    try { return JSON.stringify(d).slice(0, 300); } catch (e) { /* non JSON */ }
  }
  return 'HTTP ' + r.status;
}

function pickArr(d) {
  if (Array.isArray(d)) return d;
  if (d && Array.isArray(d.data)) return d.data;
  if (d && Array.isArray(d.items)) return d.items;
  if (d && Array.isArray(d.results)) return d.results;
  if (d && Array.isArray(d.parcelCenters)) return d.parcelCenters;
  return null;
}

/* ---------------- Yalidine ---------------- */

function yalHeaders() {
  const c = cfg();
  return {
    authorization: 'Basic ' + Buffer.from(c.yalId + ':' + c.yalTok).toString('base64'),
    accept: 'application/json'
  };
}

async function yalPost(path, obj) {
  const h = yalHeaders();
  let r = await http('POST', YAL_BASE + path, {
    headers: Object.assign({ 'content-type': 'application/json' }, h),
    body: JSON.stringify(obj)
  });
  if (!r.ok && (r.status === 400 || r.status === 415 || r.status === 422)) {
    const form = new URLSearchParams();
    Object.keys(obj).forEach((k) => {
      const v = obj[k];
      if (v === undefined || v === null) return;
      form.set(k, typeof v === 'boolean' ? (v ? '1' : '0') : String(v));
    });
    r = await http('POST', YAL_BASE + path, {
      headers: Object.assign({ 'content-type': 'application/x-www-form-urlencoded' }, h),
      body: form.toString()
    });
  }
  if (!r.ok) throw new Error('Yalidine : ' + errMsg(r));
  return r.data;
}

async function yalGet(path) {
  const r = await http('GET', YAL_BASE + path, { headers: yalHeaders() });
  if (!r.ok) throw new Error('Yalidine : ' + errMsg(r));
  return r.data;
}

async function yalTest() {
  await yalGet('/wilayas/?page_size=1');
  return { ok: true, msg: 'Connexion Yalidine réussie' };
}

async function yalCreate(o, opts) {
  const c = cfg();
  const payload = {
    order_id: o.ref,
    from_wilaya_name: c.yalFrom,
    firstname: o.firstname,
    familyname: o.familyname,
    contact_phone: normPhoneLocal(o.phone),
    address: o.addr || o.com || '',
    to_commune_name: o.com || o.wilName,
    to_wilaya_name: o.wilName,
    product_list: o.summary,
    price: clamp(Math.round(o.total), 0, 150000),
    do_insurance: false,
    weight: c.weight,
    is_stopdesk: o.stopdesk
  };
  if (o.stopdesk && opts && opts.stopdeskId) payload.stopdesk_id = Number(opts.stopdeskId);
  const d = await yalPost('/parcels/', payload);
  const box = (d && d.result && typeof d.result === 'object') ? d.result : d;
  const tracking = box && (box.tracking || box.Tracking || (Array.isArray(box) ? box[0] && box[0].tracking : ''));
  let label = '';
  const scan = (x) => { if (!label && typeof x === 'string' && /^https?:\/\//.test(x)) label = x; };
  if (box && typeof box === 'object' && !Array.isArray(box)) Object.keys(box).forEach((k) => scan(box[k]));
  if (!tracking) throw new Error('Yalidine : numéro de suivi absent de la réponse (' + JSON.stringify(d).slice(0, 200) + ')');
  return { tracking: String(tracking), label: label, status: 'En préparation' };
}

async function yalTracking(tracking) {
  let status = '';
  try {
    const d = await yalGet('/parcels/' + encodeURIComponent(tracking));
    const box = (d && d.result && typeof d.result === 'object') ? d.result : d;
    status = String((box && (box.lastStatus || box.last_status || box.status)) || '');
  } catch (e) { /* bascule sur l'historique */ }
  let history = [];
  try {
    const hd = await yalGet('/histories/' + encodeURIComponent(tracking));
    const arr = pickArr(hd) || [];
    history = arr.map((x) => ({ date: x.dateStatus || x.date_status || x.createdAt || '', status: String(x.status || '') }))
      .filter((x) => x.status)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    if (!status && history.length) status = history[0].status;
  } catch (e) { /* historique facultatif */ }
  if (!status) throw new Error('Yalidine : suivi introuvable pour ' + tracking);
  return { status: status, history: history };
}

async function yalStops(o) {
  let communeId = 0;
  try {
    const cd = await yalGet('/communes/?wilaya_id=' + o.wilCode + '&page_size=500');
    const arr = pickArr(cd) || [];
    const hit = arr.find((x) => strip(x.name) === strip(o.com)) || arr.find((x) => strip(x.name).includes(strip(o.com)) && strip(o.com));
    if (hit) communeId = Number(hit.id) || 0;
  } catch (e) { /* centres sans filtre commune */ }
  const path = '/centers/?wilaya_id=' + o.wilCode + (communeId ? '&commune_id=' + communeId : '') + '&page_size=100';
  const d = await yalGet(path);
  const arr = pickArr(d) || [];
  return arr.map((x) => ({ id: String(x.id || x.center_id || ''), name: String(x.name || x.centerName || ('Bureau ' + (x.id || ''))) }))
    .filter((x) => x.id);
}

/* ---------------- ZR Express ---------------- */

let zrTerr = { at: 0, wilayas: [], communes: {} };

function zrHeaders(tenant) {
  const c = cfg();
  const h = { 'X-Api-Key': c.zrKey, accept: 'application/json', 'content-type': 'application/json' };
  if (tenant !== false) h['X-Tenant'] = c.zrTenant;
  return h;
}

async function zrReq(method, path, body, tenant) {
  const r = await http(method, ZR_BASE + path, {
    headers: zrHeaders(tenant),
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (r.status === 401) throw new Error('ZR Express : clé API invalide ou expirée');
  if (r.status === 403) throw new Error('ZR Express : tenant invalide ou accès refusé');
  if (!r.ok) throw new Error('ZR Express : ' + errMsg(r));
  return r.data;
}

async function zrTest() {
  await zrReq('GET', '/users/profile', undefined, false);
  await zrReq('GET', '/delivery-pricing/rates');
  return { ok: true, msg: 'Connexion ZR Express réussie' };
}

async function zrTerritories() {
  if (zrTerr.at && Date.now() - zrTerr.at < 6 * 3600 * 1000 && zrTerr.wilayas.length) return zrTerr;
  const base = { pageNumber: 1, pageSize: 1000 };
  const w = await zrReq('POST', '/territories/search', Object.assign({}, base, {
    advancedFilter: { logic: 'and', filters: [{ field: 'level', operator: 'eq', value: 'wilaya' }] }
  }));
  const k = await zrReq('POST', '/territories/search', Object.assign({}, base, {
    advancedFilter: { logic: 'and', filters: [{ field: 'level', operator: 'eq', value: 'commune' }] }
  }));
  zrTerr = { at: Date.now(), wilayas: pickArr(w) || [], communes: pickArr(k) || [] };
  return zrTerr;
}

async function zrResolveTerritory(o) {
  const t = await zrTerritories();
  const wil = t.wilayas.find((x) => Number(x.code) === Number(o.wilCode)) || t.wilayas.find((x) => strip(x.name) === strip(o.wilName));
  if (!wil) throw new Error('ZR Express : wilaya inconnue « ' + o.wilName + ' »');
  const communes = t.communes.filter((x) => x.parentId === wil.id);
  let district = null;
  if (o.com) {
    district = communes.find((x) => strip(x.name) === strip(o.com))
      || communes.find((x) => strip(x.name).includes(strip(o.com)) || strip(o.com).includes(strip(x.name)));
  }
  return { cityId: wil.id, districtId: district ? district.id : wil.id, communeFound: !!district };
}

async function zrEnsureProduct(o) {
  const pid = await getSetting('zr_product_id');
  if (pid && /^[0-9a-f-]{36}$/i.test(String(pid))) return String(pid);
  const d = await zrReq('POST', '/products', { name: 'RayStore', sku: 'RAYSTORE', localStock: 10000, basePrice: 1000 });
  const id = d && (d.id || d.productId || (d.product && d.product.id));
  if (!id) throw new Error('ZR Express : création du produit impossible (' + JSON.stringify(d).slice(0, 200) + ')');
  await setSetting('zr_product_id', String(id));
  return String(id);
}

async function zrEnsureCustomer(o) {
  const phone = normPhoneZr(o.phone);
  try {
    const s = await zrReq('POST', '/customers/search', { keyword: phone, pageNumber: 1, pageSize: 10 });
    const arr = pickArr(s) || [];
    const hit = arr.find((x) => x.phone && strip(String(x.phone.number1 || '')) === strip(phone));
    if (hit && hit.id) return String(hit.id);
  } catch (e) { /* recherche facultative */ }
  const d = await zrReq('POST', '/customers/individual', { name: o.name, phone: { number1: phone } });
  const id = d && (d.id || d.customerId || (d.customer && d.customer.id));
  if (!id) throw new Error('ZR Express : création du client impossible (' + JSON.stringify(d).slice(0, 200) + ')');
  return String(id);
}

async function zrHubs(cityId, districtId) {
  const d = await zrReq('POST', '/hubs/search', { pageNumber: 1, pageSize: 200 });
  const arr = pickArr(d) || [];
  const match = arr.filter((h) => {
    const a = h.address || {};
    return (a.cityTerritoryId && a.cityTerritoryId === cityId) || (a.districtTerritoryId && a.districtTerritoryId === districtId);
  });
  return (match.length ? match : arr).map((h) => ({
    id: String(h.id || h.hubId || ''),
    name: String(h.name || h.addressText || ('Point relais ' + (h.id || '')))
  })).filter((h) => h.id).slice(0, 50);
}

async function zrCreate(o, opts) {
  const terr = await zrResolveTerritory(o);
  const customerId = await zrEnsureCustomer(o);
  const productId = await zrEnsureProduct(o);
  let hubId = null;
  if (o.stopdesk) {
    if (opts && opts.hubId) hubId = String(opts.hubId);
    else {
      const hubs = await zrHubs(terr.cityId, terr.districtId);
      if (!hubs.length) throw new Error('ZR Express : aucun point relais trouvé pour cette wilaya/commune');
      hubId = hubs[0].id;
    }
  }
  const d = await zrReq('POST', '/parcels', {
    customer: { customerId: customerId, name: o.name, phone: { number1: normPhoneZr(o.phone) } },
    deliveryAddress: { cityTerritoryId: terr.cityId, districtTerritoryId: terr.districtId, street: o.addr || o.com || '' },
    deliveryType: o.stopdesk ? 'pickup-point' : 'home',
    hubId: hubId,
    orderedProducts: [{
      productId: productId,
      productName: (o.summary || 'RayStore').slice(0, 100),
      productSku: o.ref,
      unitPrice: o.total,
      quantity: 1,
      stockType: 'none'
    }],
    description: (o.summary || '').slice(0, 250),
    amount: clamp(Math.round(o.total), 0, 150000),
    weight: { weight: cfg().weight },
    externalId: o.ref
  });
  const tracking = d && (d.trackingNumber || d.tracking || (d.parcel && d.parcel.trackingNumber));
  if (!tracking) throw new Error('ZR Express : suivi absent de la réponse (' + JSON.stringify(d).slice(0, 200) + ')');
  return { tracking: String(tracking), label: '', status: 'Commande reçue' };
}

async function zrTracking(tracking) {
  const d = await zrReq('GET', '/parcels/' + encodeURIComponent(tracking));
  const status = String((d && d.state && d.state.name) || d.status || '');
  if (!status) throw new Error('ZR Express : statut introuvable pour ' + tracking);
  let history = [];
  if (d && d.id) {
    try {
      const h = await zrReq('GET', '/parcels/' + d.id + '/state-history');
      history = (Array.isArray(h) ? h : []).map((x) => ({
        date: x.createdAt || '',
        status: String((x.newState && x.newState.name) || '')
      })).filter((x) => x.status).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    } catch (e) { /* historique facultatif */ }
  }
  return { status: status.replace(/_/g, ' '), history: history };
}

async function zrLabel(tracking) {
  const d = await zrReq('POST', '/parcels/labels/multiple/pdf', { trackingNumbers: [tracking], format: 'A6' });
  const url = d && (d.fileUrl || d.url || (Array.isArray(d.urls) && d.urls[0]));
  if (!url) throw new Error('ZR Express : étiquette non générée');
  return String(url);
}

/* ---------------- Façade ---------------- */

async function testCarrier(c) {
  if (c === 'yalidine') {
    if (!available().yalidine) throw new Error('Yalidine non configuré (YALIDINE_API_ID / YALIDINE_API_TOKEN manquants)');
    return yalTest();
  }
  if (c === 'zr') {
    if (!available().zr) throw new Error('ZR Express non configuré (ZREXPRESS_API_KEY / ZREXPRESS_TENANT_ID manquants)');
    return zrTest();
  }
  throw new Error('Transporteur inconnu');
}

async function createParcel(c, o, opts) {
  if (c === 'yalidine') {
    if (!available().yalidine) throw new Error('Yalidine non configuré');
    return yalCreate(o, opts);
  }
  if (c === 'zr') {
    if (!available().zr) throw new Error('ZR Express non configuré');
    return zrCreate(o, opts);
  }
  throw new Error('Transporteur inconnu');
}

async function getTracking(c, tracking) {
  if (c === 'yalidine') return yalTracking(tracking);
  if (c === 'zr') return zrTracking(tracking);
  throw new Error('Transporteur inconnu');
}

async function listStops(c, o) {
  if (c === 'yalidine') return yalStops(o);
  if (c === 'zr') {
    const terr = await zrResolveTerritory(o);
    return zrHubs(terr.cityId, terr.districtId);
  }
  throw new Error('Transporteur inconnu');
}

async function getLabel(c, tracking, stored) {
  if (stored) return String(stored);
  if (c === 'zr') return zrLabel(tracking);
  throw new Error('Aucune étiquette disponible');
}

module.exports = { available, testCarrier, createParcel, getTracking, listStops, getLabel, normPhoneLocal, normPhoneZr };
