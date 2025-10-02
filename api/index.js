// /api/index.js - Mono-API dla Vercel (limit 12 endpointów w trial)
// Wszystkie endpointy w jednym pliku: /api/index?endpoint=health, /api/index?endpoint=tts, etc.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || 'https://xdhlztmjktminrwmzcpl.supabase.co',
  process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhkaGx6dG1qa3RtaW5yd216Y3BsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY3MjgwMTEsImV4cCI6MjA3MjMwNDAxMX0.EmvBqbygr4VLD3PXFaPjbChakRi5YtSrxp8e_K7ZyGY'
);

// Helper functions for CORS
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// NLU Helper functions
function parseDish(text) {
  if (text.includes('pepperoni')) return 'Pizza Pepperoni';
  if (text.includes('margherita') || text.includes('margerita')) return 'Pizza Margherita';
  if (text.includes('carbonara')) return 'Spaghetti Carbonara';
  if (text.includes('schabowy')) return 'Schabowy z ziemniakami';
  if (text.includes('sushi')) return 'Sushi';
  return 'Danie';
}

function parseQty(text) {
  const mNum = text.match(/\b(\d{1,2})\b/);
  if (mNum) return parseInt(mNum[1], 10);
  return 1;
}

function parseWhen(text) {
  const m = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (m) return `${m[1].padStart(2, '0')}:${m[2]}`;
  if (text.includes('teraz')) return 'jak najszybciej';
  return '-';
}

// Endpoint handlers
async function handleHealth(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ 
      status: 'ok', 
      service: 'freeflow-backend',
      timestamp: new Date().toISOString()
    });
  }
  return res.status(405).json({ error: 'Method not allowed' });
}

async function handleTts(req, res) {
  if (req.method === 'POST') {
    try {
      return res.status(200).json({ 
        ok: true, 
        message: 'TTS placeholder (tu podłączymy Google/ElevenLabs)' 
      });
    } catch (error) {
      console.error('TTS error:', error);
      return res.status(500).json({ 
        ok: false, 
        error: 'TTS_ERROR', 
        detail: error.message 
      });
    }
  }
  return res.status(405).json({ error: 'Method not allowed' });
}

async function handleNlu(req, res) {
  if (req.method === 'POST') {
    try {
      const body = req.body || {};
      const text = String(body.text || '').toLowerCase();

      if (!text) {
        return res.status(200).json({ ok: false, error: 'NO_TEXT' });
      }

      // TODO: Replace with actual Dialogflow integration
      // For now, use simple parsing as fallback
      const parsed = {
        restaurant: text.includes('włoska') ? 'Trattoria Napoli' :
                    text.includes('polska') ? 'Złota Łyżka' : 'Demo Resto',
        items: [{ name: parseDish(text), qty: parseQty(text) }],
        when: parseWhen(text)
      };

      return res.status(200).json({ ok: true, parsed, raw: text });
    } catch (err) {
      console.error('NLU error:', err);
      return res.status(500).json({ 
        ok: false, 
        error: 'NLU_ERROR', 
        detail: String(err) 
      });
    }
  }
  return res.status(405).json({ error: 'Method not allowed' });
}

async function handleDialogflow(req, res) {
  if (req.method === 'POST') {
    try {
      const body = req.body || {};
      const text = String(body.text || body.queryText || '');
      
      if (!text) {
        return res.status(200).json({ 
          ok: false, 
          error: 'NO_TEXT',
          fulfillmentText: 'Nie rozumiem. Możesz powtórzyć?'
        });
      }

      const DIALOGFLOW_PROJECT_ID = process.env.DIALOGFLOW_PROJECT_ID || '104880919883353641559';
      const DIALOGFLOW_LANGUAGE = 'pl';
      
      // Call Dialogflow REST API
      const sessionPath = `projects/${DIALOGFLOW_PROJECT_ID}/agent/sessions/user-session-${Date.now()}`;
      
      try {
        // For now, simulate Dialogflow response based on common patterns
        // TODO: Add actual Google Cloud client library for full integration
        
        let intent = 'Default Fallback Intent';
        let fulfillmentText = 'Nie rozumiem. Możesz powtórzyć?';
        let parameters = {};
        
        // Simple intent detection
        if (text.includes('zamów') || text.includes('chcę') || text.includes('pizza')) {
          intent = 'Start.ZamowienieRestauracja';
          fulfillmentText = 'Rozumiem, że chcesz złożyć zamówienie. Jakie danie Cię interesuje?';
        } else if (text.includes('taxi') || text.includes('jadę') || text.includes('transport')) {
          intent = 'Start.Taxi';
          fulfillmentText = 'Zamawiam taxi. Skąd mam Cię odebrać?';
        } else if (text.includes('adres') || text.includes('gdzie') || text.includes('ulica')) {
          intent = 'Podaj.Adres';
          fulfillmentText = 'Podaj proszę dokładny adres dostawy.';
        } else if (text.includes('czas') || text.includes('kiedy') || text.includes('godzina')) {
          intent = 'Podaj.Czas';
          fulfillmentText = 'Na kiedy ma być dostawa?';
        } else if (text.includes('płatność') || text.includes('zapłacę') || text.includes('karta')) {
          intent = 'Podaj.Platnosc';
          fulfillmentText = 'Jak chcesz zapłacić - kartą czy gotówką?';
        } else if (text.includes('potwierdz') || text.includes('tak') || text.includes('ok')) {
          intent = 'Potwierdz';
          fulfillmentText = 'Świetnie! Zamówienie zostało potwierdzone.';
        } else if (text.includes('anuluj') || text.includes('nie') || text.includes('rezygnuj')) {
          intent = 'Anuluj';
          fulfillmentText = 'Zamówienie anulowane. Czy mogę pomóc w czymś innym?';
        }
        
        const response = {
          ok: true,
          queryText: text,
          intent: intent,
          fulfillmentText: fulfillmentText,
          parameters: parameters,
          confidence: 0.85,
          sessionPath: sessionPath
        };

      return res.status(200).json(response);
    } catch (err) {
      console.error('Dialogflow error:', err);
      return res.status(500).json({ 
        ok: false, 
        error: 'DIALOGFLOW_ERROR', 
        detail: String(err),
        fulfillmentText: 'Przepraszam, wystąpił błąd. Spróbuj ponownie.'
      });
    }
  }
  return res.status(405).json({ error: 'Method not allowed' });
}

async function handleRestaurants(req, res) {
  if (req.method === 'GET') {
    try {
      const { q } = req.query;
      
      let query = supabase
        .from('businesses')
        .select('*')
        .eq('business_type', 'restaurant');
      
      if (q) {
        query = query.ilike('name', `%${q}%`);
      }
      
      const { data, error } = await query;
      
      if (error) {
        console.error('Supabase error:', error);
        return res.status(500).json({ 
          error: 'Database error', 
          detail: error.message 
        });
      }
      
      return res.status(200).json({ 
        ok: true, 
        restaurants: data || [],
        count: data?.length || 0
      });
    } catch (err) {
      console.error('Restaurants API error:', err);
      return res.status(500).json({ 
        error: 'Server error', 
        detail: err.message 
      });
    }
  }
  return res.status(405).json({ error: 'Method not allowed' });
}

async function handleMenu(req, res) {
  if (req.method === 'GET') {
    try {
      const { restaurant_id } = req.query;
      
      if (!restaurant_id) {
        return res.status(400).json({ 
          error: 'Missing restaurant_id parameter' 
        });
      }
      
      const { data, error } = await supabase
        .from('menu_items')
        .select('*')
        .eq('business_id', restaurant_id);
      
      if (error) {
        console.error('Supabase error:', error);
        return res.status(500).json({ 
          error: 'Database error', 
          detail: error.message 
        });
      }
      
      return res.status(200).json({ 
        ok: true, 
        menu: data || [],
        count: data?.length || 0
      });
    } catch (err) {
      console.error('Menu API error:', err);
      return res.status(500).json({ 
        error: 'Server error', 
        detail: err.message 
      });
    }
  }
  return res.status(405).json({ error: 'Method not allowed' });
}

async function handleOrders(req, res) {
  // GET - list orders
  if (req.method === 'GET') {
    try {
      const { customer_id, restaurant_id } = req.query;
      
      let query = supabase
        .from('orders')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (customer_id) {
        query = query.eq('customer_id', customer_id);
      }
      
      if (restaurant_id) {
        query = query.eq('restaurant_id', restaurant_id);
      }
      
      const { data, error } = await query;
      
      if (error) {
        console.error('Supabase error:', error);
        return res.status(500).json({ 
          error: 'Database error', 
          detail: error.message 
        });
      }
      
      return res.status(200).json({ 
        ok: true, 
        orders: data || [],
        count: data?.length || 0
      });
    } catch (err) {
      console.error('Orders GET error:', err);
      return res.status(500).json({ 
        error: 'Server error', 
        detail: err.message 
      });
    }
  }
  
  // POST - create order
  if (req.method === 'POST') {
    try {
      const { restaurantId, items, customerId, total, ...rest } = req.body;
      
      if (!restaurantId || !items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ 
          error: 'Missing required fields: restaurantId, items' 
        });
      }
      
      const orderData = {
        restaurant_id: restaurantId,
        customer_id: customerId || null,
        items: items,
        total: total || 0,
        status: 'pending',
        created_at: new Date().toISOString(),
        ...rest
      };
      
      const { data, error } = await supabase
        .from('orders')
        .insert([orderData])
        .select()
        .single();
      
      if (error) {
        console.error('Supabase error:', error);
        return res.status(500).json({ 
          error: 'Database error', 
          detail: error.message 
        });
      }
      
      return res.status(200).json({ 
        ok: true, 
        order: data 
      });
    } catch (err) {
      console.error('Orders POST error:', err);
      return res.status(500).json({ 
        error: 'Server error', 
        detail: err.message 
      });
    }
  }
  return res.status(405).json({ error: 'Method not allowed' });
}

async function handleSearch(req, res) {
  try {
    const {
      query = 'pizzeria',
      lat,
      lng,
      n = '2',
      radius = '5000',
      lang = 'pl',
      rankby,
    } = req.query || {};

    const N = Math.max(1, Math.min(parseInt(n, 10) || 2, 10));
    const GMAPS_KEY =
      process.env.GOOGLE_MAPS_API_KEY ||
      process.env.GMAPS_KEY ||
      process.env.GOOGLE_MAPS_APIKEY ||
      process.env.GMAPS_API_KEY;

    if (!GMAPS_KEY) {
      return res.status(500).json({ error: 'Missing Google Maps API key' });
    }

    const hasGeo = lat && lng;
    let url, method;

    if (hasGeo) {
      const base = 'https://maps.googleapis.com/maps/api/place/nearbysearch/json';
      const params = new URLSearchParams({
        key: GMAPS_KEY,
        language: lang,
        location: `${lat},${lng}`,
        keyword: query,
      });
      if (rankby === 'distance') {
        params.set('rankby', 'distance');
      } else {
        params.set('radius', String(parseInt(radius, 10) || 5000));
      }
      if (/pizz/i.test(query)) params.set('type', 'restaurant');

      url = `${base}?${params.toString()}`;
      method = 'nearbysearch';
    } else {
      const base = 'https://maps.googleapis.com/maps/api/place/textsearch/json';
      const params = new URLSearchParams({
        key: GMAPS_KEY,
        language: lang,
        query,
      });
      url = `${base}?${params.toString()}`;
      method = 'textsearch';
    }

    const r = await fetch(url);
    const data = await r.json();

    if (data.status !== 'OK') {
      return res.status(400).json({
        error: data.status,
        message: data.error_message || null,
      });
    }

    const results = Array.isArray(data.results) ? data.results : [];

    const scored = results
      .map((p) => {
        const rating = Number(p.rating || 0);
        const reviews = Number(p.user_ratings_total || 0);
        const score = rating * reviews;
        return {
          name: p.name,
          address: p.formatted_address || p.vicinity || '',
          rating,
          reviews,
          price_level: p.price_level ?? null,
          place_id: p.place_id,
          open_now: p.opening_hours?.open_now ?? null,
          score,
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, N);

    return res.status(200).json({
      method,
      query,
      count: scored.length,
      results: scored,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || String(err) });
  }
}

async function handlePlaces(req, res) {
  // Places is an alias for search
  const { q, ...rest } = req.query;
  const searchReq = {
    ...req,
    query: {
      query: q || 'restaurant',
      ...rest
    }
  };
  return handleSearch(searchReq, res);
}

// Main handler - routing based on URL path
export default async function handler(req, res) {
  setCors(res);
  
  // Handle OPTIONS for CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // Extract endpoint from URL path
    const urlPath = req.url || '';
    const endpoint = urlPath.split('/').pop().split('?')[0];

    console.log('API Request:', req.method, urlPath, 'endpoint:', endpoint);

    // Route to appropriate handler
    switch (endpoint) {
      case 'health':
        return await handleHealth(req, res);
      case 'tts':
        return await handleTts(req, res);
      case 'nlu':
        return await handleNlu(req, res);
      case 'dialogflow':
        return await handleDialogflow(req, res);
      case 'restaurants':
        return await handleRestaurants(req, res);
      case 'menu':
        return await handleMenu(req, res);
      case 'orders':
        return await handleOrders(req, res);
      case 'search':
        return await handleSearch(req, res);
      case 'places':
        return await handlePlaces(req, res);
      case 'index':
      case '':
        // Default - return API info
        return res.status(200).json({
          service: 'freeflow-backend',
          version: '1.0.0',
          endpoints: [
            '/api/health',
            '/api/tts',
            '/api/nlu',
            '/api/dialogflow',
            '/api/restaurants',
            '/api/menu',
            '/api/orders',
            '/api/search',
            '/api/places'
          ]
        });
      default:
        return res.status(404).json({ 
          error: 'Endpoint not found',
          requested: endpoint,
          available: ['health', 'tts', 'nlu', 'restaurants', 'menu', 'orders', 'search', 'places']
        });
    }
  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      detail: error.message 
    });
  }
}
