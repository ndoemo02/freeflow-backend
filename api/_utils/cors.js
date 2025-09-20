// api/_utils/cors.js
export default function withCors(handler) {
  return async (req, res) => {
    const origin = req.headers.origin || '';
    const allowed = (process.env.CORS_ALLOWED_ORIGINS || '*')
      .split(',').map(s => s.trim());

    const allowOrigin =
      allowed.includes('*') || allowed.includes(origin) ? origin || '*' : '*';

    res.setHeader('Access-Control-Allow-Origin', allowOrigin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    // Jeśli używasz cookies/Authorization z przeglądarki → odkomentuj:
    // res.setHeader('Access-Control-Allow-Credentials', 'true');

    if (req.method === 'OPTIONS') return res.status(204).end();
    return handler(req, res);
  };
}
