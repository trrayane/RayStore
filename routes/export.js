const express = require('express');
const { query, safeParse, getSetting } = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

router.get('/json', authRequired, async (req, res) => {
  const series = await query(`SELECT k,name,short,type,lang,genres,price,old,vols,style,a,b,label,feat,img,art,author,description,active,sort_order FROM series ORDER BY k ASC`);
  const soon = await query('SELECT name,a,b,style,img,sort_order,active FROM soon ORDER BY sort_order ASC,id ASC');
  const hero = await query('SELECT item_id FROM hero ORDER BY sort_order ASC,id ASC');
  const orders = await query(`SELECT ref,name,phone,wilaya,addr,ship_method,ship_cost,sub_total,total,status,notes,lines,created_at,updated_at FROM orders ORDER BY created_at DESC`);
  const data = {
    version: '1.0',
    exportedAt: new Date().toISOString(),
    series: series.rows.map((r) => ({ ...r, genres: safeParse(r.genres, []), vols: safeParse(r.vols, []), feat: !!r.feat, active: !!r.active, desc: r.description || '' })),
    soon: soon.rows.map((r) => ({ ...r, active: !!r.active })),
    hero: hero.rows.map((r) => r.item_id),
    orders: orders.rows.map((r) => ({ ...r, ship_cost: Number(r.ship_cost), sub_total: Number(r.sub_total), total: Number(r.total), lines: safeParse(r.lines, []) })),
    settings: {
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
        comics: !!(await getSetting('homesec_comics')),
        manga: !!(await getSetting('homesec_manga')),
        manhwa: !!(await getSetting('homesec_manhwa')),
        novel: !!(await getSetting('homesec_novel')),
        goods: !!(await getSetting('homesec_goods'))
      }
    }
  };
  res.setHeader('Content-Disposition', `attachment; filename="raystore-backup-${new Date().toISOString().slice(0,10)}.json"`);
  res.setHeader('Content-Type', 'application/json');
  res.send(JSON.stringify(data, null, 2));
});

module.exports = router;
