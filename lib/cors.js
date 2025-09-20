// lib/cors.js
const parseList = (v='') => v.split(',').map(s => s.trim()).filter(Boolean);

export function applyCors(req, res) {
  const conf = process.env.CORS_ALLOWED_ORIGINS || '';
  const allowAll  = conf === '*';
  const allowList = parseList(conf);
  const origin    = req.headers.origin || '';

  res.setHeader('Vary', 'Origin');

  // Brak Origin (np. health) – nie wymuszamy CORS
  if (!origin) {
    if (req.method === 'OPTIONS') { res.status(204).end(); return true; }
    return false;
  }

  const isAllowed = allowAll || allowList.includes(origin);
  if (!isAllowed) { res.status(403).json({ error: 'Origin not allowed' }); return true; }

  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') { res.status(204).end(); return true; }
  return false;
}
