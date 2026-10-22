/* Préchauffe le cache CDN chaque image du catalogue pour servirées en HIT dès la première visite. */
(async () => {
  const res = await fetch('https://raystore.space/api/products');
  const list = await res.json();
  const urls = new Set();
  for (const s of list) {
    if (s.img && /^https?:/.test(s.img)) urls.add(s.img);
    if (s.art && /^https?:/.test(s.art)) urls.add(s.art);
  }
  const bust = Date.now();
  const jobs = [...urls].map(u => u + (u.includes('?') ? '&' : '?') + 'warm=' + bust);
  let i = 0, ok = 0, fail = 0;
  const t0 = Date.now();
  async function worker() {
    while (i < jobs.length) {
      const u = jobs[i++];
      try { const r = await fetch(u); if (r.ok) ok++; else fail++; }
      catch (e) { fail++; }
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
  console.log(`Préchauffé: ${ok}/${jobs.length} OK, ${fail} echec, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
})().catch(e => { console.error(e.message); process.exit(1); });
