const { query } = require('./db');

async function logMovement(client, m) {
  const run = client ? client.query.bind(client) : query;
  await run(
    'INSERT INTO stock_movements (k, name, delta, stock_after, reason, ref) VALUES ($1,$2,$3,$4,$5,$6)',
    [
      String(m.k || ''),
      String(m.name || '').slice(0, 200),
      Math.round(Number(m.delta) || 0),
      Math.max(0, Math.round(Number(m.stock_after) || 0)),
      String(m.reason || '').slice(0, 120),
      String(m.ref || '').slice(0, 60)
    ]
  );
}

async function listMovements(opts) {
  const lim = Math.min(500, Math.max(1, Number(opts && opts.limit) || 100));
  const k = opts && opts.k ? String(opts.k) : '';
  const r = k
    ? await query('SELECT id, k, name, delta, stock_after, reason, ref, created_at FROM stock_movements WHERE k=$1 ORDER BY created_at DESC, id DESC LIMIT $2', [k, lim])
    : await query('SELECT id, k, name, delta, stock_after, reason, ref, created_at FROM stock_movements ORDER BY created_at DESC, id DESC LIMIT $1', [lim]);
  return r.rows;
}

module.exports = { logMovement, listMovements };
