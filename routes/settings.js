const express = require('express');
const { getSetting, setSetting } = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

router.get('/', async (req, res) => {
  res.json({
    store: {
      name: await getSetting('store_name'),
      whatsapp: await getSetting('store_whatsapp'),
      instagram: await getSetting('store_instagram')
    },
    ship: {
      home: await getSetting('ship_home'),
      stopdesk: await getSetting('ship_stopdesk')
    },
    homesec: {
      manga: !!(await getSetting('homesec_manga')),
      manhwa: !!(await getSetting('homesec_manhwa')),
      novel: !!(await getSetting('homesec_novel')),
      goods: !!(await getSetting('homesec_goods'))
    },
    hasPasswordHash: !!(await getSetting('admin_password_hash'))
  });
});

router.put('/', authRequired, async (req, res) => {
  const body = req.body || {};
  if (body.store) {
    if (body.store.name != null) await setSetting('store_name', body.store.name);
    if (body.store.whatsapp != null) await setSetting('store_whatsapp', body.store.whatsapp);
    if (body.store.instagram != null) await setSetting('store_instagram', body.store.instagram);
  }
  if (body.ship) {
    if (body.ship.home != null) await setSetting('ship_home', Number(body.ship.home) || 0);
    if (body.ship.stopdesk != null) await setSetting('ship_stopdesk', Number(body.ship.stopdesk) || 0);
  }
  if (body.homesec) {
    if (body.homesec.manga != null) await setSetting('homesec_manga', !!body.homesec.manga);
    if (body.homesec.manhwa != null) await setSetting('homesec_manhwa', !!body.homesec.manhwa);
    if (body.homesec.novel != null) await setSetting('homesec_novel', !!body.homesec.novel);
    if (body.homesec.goods != null) await setSetting('homesec_goods', !!body.homesec.goods);
  }
  res.json({ success: true });
});

module.exports = router;
