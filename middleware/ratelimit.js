/* Rate limiting simple en mémoire, sans dépendance.
   Fenêtre glissante par IP (validée par l'adresse telle qu'arrivée derrière Vercel). */
const buckets = new Map();
let lastClean = 0;

function rateLimit({ windowMs, max, scale } = {}) {
  const win = windowMs || 10 * 60 * 1000;
  const limit = max || 10;
  return function (req, res, next) {
    const ip = String(
      (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
      req.headers['x-real-ip'] ||
      (req.socket && req.socket.remoteAddress) ||
      'inconnu'
    );
    const now = Date.now();
    const key = ip + (scale ? ':' + scale : '');
    let b = buckets.get(key);
    if (!b || now - b.start > win) {
      b = { start: now, n: 0 };
      buckets.set(key, b);
      if (now - lastClean > win && buckets.size > 3000) {
        for (const [k, v] of buckets) {
          if (now - v.start > win) buckets.delete(k);
        }
        lastClean = now;
      }
    }
    b.n++;
    if (b.n > limit) {
      return res.status(429).json({ error: 'Trop de requêtes. Réessaie dans quelques minutes.' });
    }
    next();
  };
}

module.exports = { rateLimit };
