const { getSetting, setSetting } = require('./db');

const YAL_BASE = 'https://api.yalidine.app/v1';
const ZR_BASE = 'https://api.zrexpress.app/api/v1';
const AND_BASE = 'https://anderson-ecommerce.ecotrack.dz/api/v1';
const TIMEOUT = 15000;

function cfg() {
  return {
    yalId: String(process.env.YALIDINE_API_ID || '').trim(),
    yalTok: String(process.env.YALIDINE_API_TOKEN || '').trim(),
    yalFrom: String(process.env.YALIDINE_FROM_WILAYA || 'Alger').trim() || 'Alger',
    weight: Math.max(1, Number(process.env.YALIDINE_WEIGHT) || 1),
    zrKey: String(process.env.ZREXPRESS_API_KEY || process.env.ZR_API_KEY || '').trim(),
    zrTenant: String(process.env.ZREXPRESS_TENANT_ID || process.env.ZR_TENANT || '').trim(),
    andTok: String(process.env.ANDERSON_API_TOKEN || process.env.ANDERSON_TOKEN || '').trim(),
    andBase: String(process.env.ANDERSON_BASE_URL || AND_BASE).replace(/\/+$/, ''),
    andAuto: String(process.env.ANDERSON_AUTO_VALIDATE || '1').trim() !== '0'
  };
}

function available() {
  const c = cfg();
  return { yalidine: !!(c.yalId && c.yalTok), zr: !!(c.zrKey && c.zrTenant), anderson: !!c.andTok };
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

/* Wilayas 59–69 (loi 26-06 / décret 26-206) : les API transporteurs ne les
   reconnaissent pas encore, on expédie sous la wilaya mère jusqu'au 31/12/2026. */
const WILAYA_PARENT = {
  59: 'Laghouat', 60: 'Batna', 61: 'Biskra', 62: 'Tébessa', 63: 'Tlemcen',
  64: 'Tiaret', 65: 'Djelfa', 66: 'Djelfa', 67: 'Médéa', 68: "M'Sila", 69: 'El Bayadh'
};
const WILAYA_PARENT_CODE = { 59: 3, 60: 5, 61: 7, 62: 12, 63: 13, 64: 14, 65: 17, 66: 17, 67: 26, 68: 28, 69: 32 };

// Nom de wilaya à donner au transporteur : la mère si la wilaya est nouvelle, sinon le libellé tel quel.
function shipWilaya(o) {
  return WILAYA_PARENT[o.wilCode] || o.wilName;
}

// Code wilaya côté transporteur : le code mère quand la wilaya est nouvelle, sinon le code tel quel.
function shipWilayaCode(o) {
  return WILAYA_PARENT_CODE[o.wilCode] || o.wilCode;
}

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
    to_wilaya_name: shipWilaya(o),
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
  const aw = shipWilayaCode(o);
  let communeId = 0;
  try {
    const cd = await yalGet('/communes/?wilaya_id=' + aw + '&page_size=500');
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
  const shipCode = shipWilayaCode(o);
  const shipName = shipWilaya(o);
  const wil = t.wilayas.find((x) => Number(x.code) === Number(shipCode)) || t.wilayas.find((x) => strip(x.name) === strip(shipName));
  if (!wil) throw new Error('ZR Express : wilaya inconnue « ' + shipName + ' »');
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

/* ---------------- Anderson Delivery (plateforme Ecotrack) ---------------- */

const AND_STATUS = {
  created: 'Créée', pending: 'En attente', pending_pickup: 'En attente de ramassage',
  picked_up: 'Ramassé', collected: 'Ramassé', ramasse: 'Ramassé',
  in_transit: 'En transit', dispatched: 'Expédié', expedie: 'Expédié',
  out_for_delivery: 'En cours de livraison', en_livraison: 'En cours de livraison',
  dispatched_to_driver: 'En cours de livraison', livreur_dispatch: 'En cours de livraison',
  delivered: 'Livré', livred: 'Livré', livre: 'Livré',
  failed_delivery: 'Tentative échouée', delivery_attempted: 'Tentative échouée',
  returning: 'Retour en cours', return_in_transit: 'Retour en cours', retour_en_cours: 'Retour en cours',
  returned: 'Retourné', retour_recu: 'Retourné', retourne: 'Retourné',
  cancelled: 'Annulé', annule: 'Annulé',
  ready_for_pickup: 'Au point relais', stop_desk: 'Au point relais',
  exception: 'Incident', lost: 'Perdu'
};

function andStatusLabel(raw) {
  const k = strip(raw).replace(/[\s-]+/g, '_');
  return AND_STATUS[k] || String(raw || '').trim();
}

function andHeaders() {
  return { authorization: 'Bearer ' + cfg().andTok, accept: 'application/json', 'content-type': 'application/json' };
}

async function andGet(path) {
  const r = await http('GET', cfg().andBase + path, { headers: andHeaders() });
  if (!r.ok) throw new Error('Anderson : ' + errMsg(r));
  return r.data;
}

async function andPost(path, body) {
  const r = await http('POST', cfg().andBase + path, { headers: andHeaders(), body: body === undefined ? undefined : JSON.stringify(body) });
  if (!r.ok) throw new Error('Anderson : ' + errMsg(r));
  const d = r.data;
  if (d && typeof d === 'object' && d.success === false) throw new Error('Anderson : ' + (d.message || 'échec de la requête'));
  return d;
}

async function andTest() {
  await andGet('/get/wilayas');
  return { ok: true, msg: 'Connexion Anderson Delivery réussie' };
}

let andComm = { at: 0, byWil: {} };

async function andCommunes(wilCode) {
  const key = String(wilCode);
  if (andComm.at && Date.now() - andComm.at < 6 * 3600 * 1000 && andComm.byWil[key]) return andComm.byWil[key];
  const d = await andGet('/get/communes?wilaya_id=' + encodeURIComponent(key));
  const arr = pickArr(d) || [];
  if (!andComm.at || Date.now() - andComm.at > 6 * 3600 * 1000) andComm = { at: Date.now(), byWil: {} };
  andComm.byWil[key] = arr;
  return arr;
}

async function andResolveCommune(o) {
  const arr = await andCommunes(shipWilayaCode(o));
  const want = strip(o.com);
  let hit = arr.find((x) => strip(x.nom) === want);
  if (!hit && want) hit = arr.find((x) => strip(x.nom).includes(want) || want.includes(strip(x.nom)));
  return hit ? String(hit.nom) : String(o.com || o.wilName || '');
}

async function andStops(o) {
  const arr = await andCommunes(shipWilayaCode(o));
  const seen = {};
  return arr.filter((x) => Number(x.has_stop_desk) === 1 && Number(x.is_active) !== 0)
    .map((x) => ({ id: String(x.code_postal || ''), name: String(x.nom || '') }))
    .filter((x) => { if (!x.id || !x.name || seen[x.id]) return false; seen[x.id] = 1; return true; })
    .slice(0, 100);
}

function andPickTracking(d) {
  const scan = (x) => {
    if (!x || typeof x !== 'object') return '';
    const direct = x.tracking || x.tracking_number || x.trackingNumber || x.code_suivi;
    if (direct) return String(direct);
    for (const k of ['data', 'order', 'result']) {
      const v = x[k];
      if (v && typeof v === 'object') { const t = scan(v); if (t) return t; }
      if (Array.isArray(v) && v.length) { const t = scan(v[0]); if (t) return t; }
    }
    return '';
  };
  return scan(d);
}

async function andCreate(o, opts) {
  const c = cfg();
  let commune = await andResolveCommune(o);
  const payload = {
    reference: o.ref,
    nom_client: o.name,
    telephone: normPhoneLocal(o.phone),
    adresse: o.addr || o.com || o.wilName,
    code_wilaya: shipWilayaCode(o),
    commune: commune,
    produit: o.summary || 'RayStore',
    montant: clamp(Math.round(o.total), 0, 150000),
    type: 1,
    stop_desk: o.stopdesk ? 1 : 0
  };
  if (o.stopdesk && opts && opts.stopdeskId) {
    payload.code_postal = String(opts.stopdeskId);
    const arr = await andCommunes(shipWilayaCode(o));
    const desk = arr.find((x) => String(x.code_postal) === String(opts.stopdeskId));
    if (desk && desk.nom) payload.commune = String(desk.nom);
  }
  const qs = new URLSearchParams();
  Object.keys(payload).forEach((k) => { const v = payload[k]; if (v !== undefined && v !== null) qs.set(k, String(v)); });
  const d = await andPost('/create/order?' + qs.toString(), payload);
  const tracking = andPickTracking(d);
  if (!tracking) throw new Error('Anderson : numéro de suivi absent de la réponse (' + JSON.stringify(d).slice(0, 200) + ')');
  let status = 'Prête à expédier';
  if (c.andAuto) {
    try {
      await andPost('/valid/order?tracking=' + encodeURIComponent(tracking));
      status = 'Expédiée';
    } catch (e) { /* le colis existe quand même, en attente de validation */ }
  }
  return { tracking: tracking, label: '', status: status };
}

function andActivity(d) {
  const find = (x, depth) => {
    if (!x || typeof x !== 'object' || depth > 6) return null;
    if (Array.isArray(x.activity)) return x.activity;
    if (Array.isArray(x.activities)) return x.activities;
    if (Array.isArray(x) && x.length && x[0] && typeof x[0] === 'object' && (x[0].status || x[0].date)) return x;
    for (const k of Object.keys(x)) {
      const v = x[k];
      if (v && typeof v === 'object') { const r = find(v, depth + 1); if (r) return r; }
    }
    return null;
  };
  return find(d, 0) || [];
}

async function andTracking(tracking) {
  const d = await andGet('/get/tracking/info?tracking=' + encodeURIComponent(tracking));
  if (d && typeof d === 'object' && d.success === false) {
    throw new Error('Anderson : suivi introuvable pour ' + tracking + (d.message ? ' (' + d.message + ')' : ''));
  }
  const arr = andActivity(d);
  const history = arr.map((x) => {
    const at = [x.date || x.created_at || x.at || '', x.time || ''].join(' ').trim();
    return { date: at, status: andStatusLabel(x.status || x.statut || x.state || '') };
  }).filter((x) => x.status).reverse();
  const usable = arr.filter((x) => strip(x.status || x.statut || '').replace(/[\s-]+/g, '_') !== 'notification_on_order');
  const last = usable.length ? usable[usable.length - 1] : null;
  let status = last ? andStatusLabel(last.status || last.statut || last.state || '') : '';
  if (!status && history.length) status = history[0].status;
  if (!status) status = 'En attente';
  return { status: status, history: history };
}

async function andLabel(tracking) {
  const r = await fetch(cfg().andBase + '/get/order/label?tracking=' + encodeURIComponent(tracking), {
    headers: { authorization: 'Bearer ' + cfg().andTok },
    signal: AbortSignal.timeout(TIMEOUT)
  });
  if (!r.ok) throw new Error('Anderson : étiquette indisponible (HTTP ' + r.status + ')');
  const ct = String(r.headers.get('content-type') || '');
  const buf = Buffer.from(await r.arrayBuffer());
  if (!buf.length) throw new Error('Anderson : étiquette vide');
  if (/json|text/i.test(ct) && buf.slice(0, 1).toString() === '{') {
    let d = null; try { d = JSON.parse(buf.toString('utf8')); } catch (e) { d = null; }
    throw new Error('Anderson : ' + ((d && (d.message || d.error)) || 'étiquette indisponible'));
  }
  return 'data:application/pdf;base64,' + buf.toString('base64');
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
  if (c === 'anderson') {
    if (!available().anderson) throw new Error('Anderson Delivery non configuré (ANDERSON_API_TOKEN manquant)');
    return andTest();
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
  if (c === 'anderson') {
    if (!available().anderson) throw new Error('Anderson Delivery non configuré');
    return andCreate(o, opts);
  }
  throw new Error('Transporteur inconnu');
}

async function getTracking(c, tracking) {
  if (c === 'yalidine') return yalTracking(tracking);
  if (c === 'zr') return zrTracking(tracking);
  if (c === 'anderson') return andTracking(tracking);
  throw new Error('Transporteur inconnu');
}

async function listStops(c, o) {
  if (c === 'yalidine') return yalStops(o);
  if (c === 'zr') {
    const terr = await zrResolveTerritory(o);
    return zrHubs(terr.cityId, terr.districtId);
  }
  if (c === 'anderson') return andStops(o);
  throw new Error('Transporteur inconnu');
}

async function getLabel(c, tracking, stored) {
  if (stored) return String(stored);
  if (c === 'zr') return zrLabel(tracking);
  if (c === 'anderson') return andLabel(tracking);
  throw new Error('Aucune étiquette disponible');
}

module.exports = { available, testCarrier, createParcel, getTracking, listStops, getLabel, normPhoneLocal, normPhoneZr };
