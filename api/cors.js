export function applyCors(req, res) {
  const rawOrigins = process.env.CORS_ALLOWED_ORIGINS ?? '*';
  const allowedOrigins = rawOrigins
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);

  const origin = req?.headers?.origin;
  const allowAny = allowedOrigins.length === 0 || allowedOrigins.includes('*');
  let allowOrigin;

  if (allowAny) {
    allowOrigin = origin || '*';
  } else if (origin && allowedOrigins.includes(origin)) {
    allowOrigin = origin;
  }

  if (allowOrigin) {
    res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    if (typeof res.status === 'function') {
      res.status(200);
    } else {
      res.statusCode = 200;
    }
    if (typeof res.end === 'function') {
      res.end();
    }
    return true;
  }

  if (!allowOrigin && !allowAny) {
    if (typeof res.status === 'function') {
      res.status(403);
    } else {
      res.statusCode = 403;
    }

    const payload = { error: 'Origin not allowed' };
    if (typeof res.json === 'function') {
      res.json(payload);
    } else {
      res.setHeader('Content-Type', 'application/json');
      if (typeof res.end === 'function') {
        res.end(JSON.stringify(payload));
      }
    }
    return true;
  }

  return false;
}
