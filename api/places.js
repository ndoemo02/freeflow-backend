// --- CORS (wspólne)
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export default async function handler(req, res) {
  // szybka obsługa OPTIONS
  if (req.method === 'OPTIONS') {
    Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(204).end();
  }
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));

  try {
    if (!process.env.GOOGLE_MAPS_API_KEY) {
      return res.status(500).json({ error: 'Missing GOOGLE_MAPS_API_KEY' });
    }

    // --- pobranie parametrów (GET lub JSON POST)
    const isGet = req.method === 'GET';
    const params = isGet
      ? req.query
      : (req.headers['content-type'] || '').includes('application/json')
        ? (await safeJsonBody(req))
        : Object.fromEntries(new URLSearchParams(await readBody(req)));

    const queryRaw = (params.query || params.keyword || '').toString().trim();
    const query = queryRaw;
    const lat = parseFloat(params.lat);
    const lng = parseFloat(params.lng);
    const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);

    const language = (params.language || 'pl').toString();
    const n = clampInt(params.n, 5, 1, 20);
    const radius = clampInt(params.radius, 3000, 100, 50000);
    const typeParam = (params.type || '').toString().trim().toLowerCase();

    // Wykrywanie kategorii z query → mapowanie na Google type
    const categoryToType = {
      pizza: 'restaurant',
      sushi: 'restaurant',
      restauracje: 'restaurant',
      kebab: 'restaurant',
      hotel: 'lodging',
      taxi: 'taxi_stand',
      bar: 'bar',
      kawiarnia: 'cafe',
      cafe: 'cafe',
      sklep: 'store'
    };
    let detectedType = null;
    for (const [category, googleType] of Object.entries(categoryToType)) {
      if (query.toLowerCase().includes(category)) {
        detectedType = googleType;
        break;
      }
    }
    const finalType = typeParam || detectedType || '';

    // --- wybór endpointu i walidacja
    // Google Places:
    // - Text Search: wymaga `query` (opcjonalnie location+radius)
    // - Nearby Search: gdy brak `query`, wymaga `location` + (type lub keyword) + radius
    let endpoint = '';
    const url = new URL('https://maps.googleapis.com/maps/api/place/placeholder');

    if (query) {
      endpoint = 'textsearch';
      url.pathname = `/maps/api/place/${endpoint}/json`;
      url.searchParams.set('query', query);
      if (hasCoords) {
        url.searchParams.set('location', `${lat},${lng}`);
        url.searchParams.set('radius', String(radius));
      }
      if (finalType) url.searchParams.set('type', finalType);
    } else if (hasCoords) {
      endpoint = 'nearbysearch';
      if (!finalType) {
        return res.status(400).json({
          error: 'Missing type for nearby search',
          hint: 'Provide ?type=restaurant (or include a category in query) together with lat,lng'
        });
      }
      url.pathname = `/maps/api/place/${endpoint}/json`;
      url.searchParams.set('location', `${lat},${lng}`);
      url.searchParams.set('radius', String(radius));
      url.searchParams.set('type', finalType);
    } else {
      return res.status(400).json({
        error: 'Missing query or location',
        hint: 'Provide either ?query=pizza+Krakow OR ?lat=50.06&lng=19.94&type=restaurant&radius=2000'
      });
    }

    url.searchParams.set('language', language);
    url.searchParams.set('key', process.env.GOOGLE_MAPS_API_KEY);

    // --- Request do Google z timeout i retry
    let data;
    let attempts = 0;
    const maxAttempts = 2;

    while (attempts < maxAttempts) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);

        const r = await fetch(url.toString(), {
          signal: controller.signal,
          headers: { 'User-Agent': 'FreeFlow-App/1.0' }
        });

        clearTimeout(timeoutId);

        if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.statusText}`);
        data = await r.json();
        break; // sukces
      } catch (error) {
        attempts++;
        if (attempts >= maxAttempts) {
          if (error.name === 'AbortError') {
            return res.status(504).json({ error: 'Request timeout - Google Places API nie odpowiada' });
          }
          return res.status(502).json({ error: `Upstream error: ${error.message}` });
        }
        await wait(1000);
      }
    }

    // Obsługa statusów Google
    const okStatuses = new Set(['OK', 'ZERO_RESULTS']);
    if (!okStatuses.has(data.status)) {
      return res.status(502).json({
        status: data.status,
        error: data.error_message || 'Upstream error (Google Places)',
        endpoint
      });
    }

    const results = Array.isArray(data.results) ? data.results : [];
    const sorted = results
      .filter(x => x && typeof x === 'object')
      .sort((a, b) => {
        const ra = a.rating ?? 0, rb = b.rating ?? 0;
        if (rb !== ra) return rb - ra;
        const va = a.user_ratings_total ?? 0, vb = b.user_ratings_total ?? 0;
        return vb - va;
      })
      .slice(0, n)
      .map(x => ({
        name: x.name || null,
        rating: x.rating ?? null,
        votes: x.user_ratings_total ?? null,
        address: x.formatted_address || x.vicinity || null,
        place_id: x.place_id || null,
      }));

    return res.status(200).json({
      status: data.status,
      endpoint,
      total: results.length,
      results: sorted
    });
  } catch (err) {
    console.error('places handler error', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}

// --- helpers
function clampInt(v, def, min, max) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}
async function readBody(req) {
  return await new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}
async function safeJsonBody(req) {
  try {
    const raw = await readBody(req);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    throw new Error('Invalid JSON body');
  }
}
function wait(ms) {
  return new Promise(r => setTimeout(r, ms));
}
