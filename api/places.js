// --- CORS (wspólne)
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// szybka obsługa OPTIONS
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(204).end();
  }
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));

  try {
    if (!process.env.GOOGLE_MAPS_API_KEY) {
      return res.status(500).json({ error: 'Missing GOOGLE_MAPS_API_KEY' });
    }

    const isGet = req.method === 'GET';
    const params = isGet
      ? req.query
      : (req.headers['content-type'] || '').includes('application/json')
        ? (req.body || {})
        : Object.fromEntries(new URLSearchParams(await readBody(req)));

    const query = params.query || params.keyword || '';
    const lat = parseFloat(params.lat);
    const lng = parseFloat(params.lng);
    const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);

    const language = (params.language || 'pl').toString();
    const n = clampInt(params.n, 3, 1, 10);
    const radius = clampInt(params.radius, 3000, 100, 50000);
    const rankby = (params.rankby || '').toString();
    const type = (params.type || '').toString();

    // --- Ulepszona logika: sprawdzamy czy w zapytaniu jest nazwa miasta
    // Lepsze rozpoznawanie miast i dzielnic
    const cityRegex = /\b(w|we|na)\s+[A-ZŁĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]+/i;
    const queryContainsCity = cityRegex.test(query);
    
    // Mapowanie kategorii na typy Google Places
    const categoryToType = {
      'pizza': 'restaurant',
      'sushi': 'restaurant', 
      'restauracje': 'restaurant',
      'kebab': 'restaurant',
      'hotel': 'lodging',
      'taxi': 'taxi_stand'
    };
    
    // Wykryj kategorię z query
    let detectedType = null;
    for (const [category, googleType] of Object.entries(categoryToType)) {
      if (query.toLowerCase().includes(category)) {
        detectedType = googleType;
        break;
      }
    }

    // Budujemy URL do Google Places
    const url = new URL('https://maps.googleapis.com/maps/api/place/textsearch/json');
    if (query) url.searchParams.set('query', query);

    if (!queryContainsCity && hasCoords) {
      // jeśli nie ma miasta, to bierzemy GPS
      url.searchParams.set('location', `${lat},${lng}`);
      if (rankby === 'distance') {
        url.searchParams.set('rankby', 'distance');
      } else {
        url.searchParams.set('radius', String(radius));
      }
    }

    url.searchParams.set('language', language);
    if (detectedType) {
      url.searchParams.set('type', detectedType);
    } else if (type) {
      url.searchParams.set('type', type);
    }
    url.searchParams.set('key', process.env.GOOGLE_MAPS_API_KEY);

    // Request do Google z timeout i retry
    let data;
    let attempts = 0;
    const maxAttempts = 2;
    
    while (attempts < maxAttempts) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000); // 8 sekund timeout
        
        const r = await fetch(url.toString(), {
          signal: controller.signal,
          headers: {
            'User-Agent': 'FreeFlow-App/1.0'
          }
        });
        
        clearTimeout(timeoutId);
        
        if (!r.ok) {
          throw new Error(`HTTP ${r.status}: ${r.statusText}`);
        }
        
        data = await r.json();
        break; // Sukces - wychodzimy z pętli
        
      } catch (error) {
        attempts++;
        console.error(`Attempt ${attempts} failed:`, error.message);
        
        if (attempts >= maxAttempts) {
          if (error.name === 'AbortError') {
            return res.status(504).json({ 
              error: 'Request timeout - Google Places API nie odpowiada' 
            });
          }
          return res.status(502).json({ 
            error: `Upstream error: ${error.message}` 
          });
        }
        
        // Czekaj przed kolejną próbą
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      return res.status(502).json({ status: data.status, error: data.error_message || 'Upstream error' });
    }

    const results = Array.isArray(data.results) ? data.results : [];
    const sorted = results
      .filter(x => x && (typeof x === 'object'))
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
      total: results.length,
      results: sorted,
    });
  } catch (err) {
    console.error('places handler error', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}

// helpers
function clampInt(v, def, min, max) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}
async function readBody(req) {
  return await new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}
