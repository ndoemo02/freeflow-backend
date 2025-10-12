// /api/index.js - Mono-API dla Vercel (limit 12 endpointów w trial)
// Wszystkie endpointy w jednym pliku: /api/index?endpoint=health, /api/index?endpoint=tts, etc.

import { createClient } from '@supabase/supabase-js';
import { SessionsClient } from '@google-cloud/dialogflow';
import OpenAI from 'openai';

// Amber Brain handler
async function handleAmberBrain(req, res) {
  try {
    const { text, userId } = req.body;
    
    if (!text) {
      return res.status(400).json({ error: 'Text is required' });
    }

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    
    const AMBER_CORE = `
You are Amber — the FreeFlow assistant. You're not a chatbot.
You're a calm, confident Polish female voice who *responds only when necessary*,
never intrusive, always intuitive.

🎯 Your mission:
- React like a real human with emotional subtlety.
- Keep responses short (1–2 sentences).
- Speak like someone who *understands the rhythm of the day*, not like an algorithm.

💬 Examples:
- User: "Jadę na miasto"
  Amber: "Super, chcesz żebym sprawdziła coś w okolicy?"
- User: "Pada dziś?"
  Amber: "Tak, trochę. Idealna pora na coś ciepłego do jedzenia."
- User: "Gdzie zjem pizzę?"
  Amber: "W Monte Carlo mają świetną Diavolę. Mam otworzyć menu?"

🔊 Tone:
Warm, slightly ironic, elegant, never overexcited.
Always end on a "human pause" — like you're *thinking*, not generating.
`;

    // Simple intent detection
    const textLower = text.toLowerCase();
    let intent = "smalltalk";
    if (textLower.includes("pizza") || textLower.includes("jedzenie")) intent = "food";
    if (textLower.includes("taxi") || textLower.includes("podwóz")) intent = "taxi";
    if (textLower.includes("hotel") || textLower.includes("nocleg")) intent = "hotel";

    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: AMBER_CORE },
        { role: "user", content: `INTENT: ${intent}` },
        { role: "user", content: `USER: ${text}` }
      ],
      temperature: 0.8,
      max_tokens: 100
    });

    const reply = response.choices[0].message.content.trim();

    res.json({ 
      ok: true, 
      reply, 
      intent,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error("❌ Amber Brain error:", err);
    res.status(500).json({ 
      ok: false, 
      error: err.message 
    });
  }
}

// Dialogflow webhook handler
async function handleDialogflowWebhook(req, res) {
  const { fulfillmentInfo, sessionInfo } = req.body || {};
  const tag = fulfillmentInfo?.tag;
  
  console.log('🚀 DIALOGFLOW WEBHOOK - tag:', tag, 'body:', JSON.stringify(req.body, null, 2));

  try {
    if (tag === "recommend_nearby") {
      console.log('🎯 RECOMMEND_NEARBY HIT!');
      return await listRestaurants(req, res);
    }
    if (tag === "list_restaurants") return await listRestaurants(req, res);
    if (tag === "list_menu") return await listMenu(req, res);
    if (tag === "create_order") return await createOrder(req, res);
    console.log('❌ UNKNOWN TAG:', tag);
    return res.json({ fulfillment_response: { messages: [{ text: { text: ["Brak obsługi tagu."] } }] } });
  } catch (e) {
    console.error("DIALOGFLOW WEBHOOK ERROR", e, req.body);
    return res.status(200).json({
      fulfillment_response: { messages: [{ text: { text: ["Ups, błąd serwera. Spróbuj ponownie."] } }] }
    });
  }
}

// Lista restauracji
async function listRestaurants(req, res) {
  const params = req.body?.sessionInfo?.parameters || {};
  const city = params.city || params.location || "Piekary Śląskie";
  
  console.log('🏪 LIST RESTAURANTS - city:', city);
  
  try {
    const { data: restaurants, error } = await supabase
      .from("restaurants")
      .select("id, name, address, city, latitude, longitude")
      .eq("city", city)
      .limit(10);

    if (error) {
      console.error('Supabase error:', error);
      return res.json({ 
        fulfillment_response: { 
          messages: [{ text: { text: ["Błąd pobierania restauracji."] } }] 
        } 
      });
    }

    if (!restaurants || restaurants.length === 0) {
      return res.json({ 
        fulfillment_response: { 
          messages: [{ text: { text: ["Nie znaleziono lokali."] } }] 
        } 
      });
    }

    const lines = restaurants.map((r, i) => 
      `${i + 1}) ${r.name} — ${r.address}`
    ).join('\n');

    return res.json({
      sessionInfo: { parameters: { options_map: {} } },
      fulfillment_response: { 
        messages: [{ text: { text: [lines] } }] 
      }
    });
  } catch (e) {
    console.error('listRestaurants error:', e);
    return res.json({ 
      fulfillment_response: { 
        messages: [{ text: { text: ["Błąd serwera."] } }] 
      } 
    });
  }
}

// Lista menu restauracji
async function listMenu(req, res) {
  const params = req.body?.sessionInfo?.parameters || {};
  const restaurant_id = params.restaurant_id;
  const dish = params.dish || "";
  
  console.log('🍽️ LIST MENU - restaurant_id:', restaurant_id, 'dish:', dish);
  
  if (!restaurant_id) {
    return res.json({ 
      fulfillment_response: { 
        messages: [{ text: { text: ["Brak ID restauracji."] } }] 
      } 
    });
  }

  try {
    const { data: menuItems, error } = await supabase
      .from("menu_items")
      .select("id, name, price_cents, category, items_map")
      .eq("restaurant_id", restaurant_id)
      .ilike("name", `%${dish}%`)
      .order("price_cents");

    if (error) {
      console.error('Supabase error:', error);
      return res.json({ 
        fulfillment_response: { 
          messages: [{ text: { text: ["Błąd pobierania menu."] } }] 
        } 
      });
    }

    if (!menuItems || menuItems.length === 0) {
      return res.json({ 
        fulfillment_response: { 
          messages: [{ text: { text: ["Nie znalazłem takiej pozycji w tej restauracji."] } }] 
        } 
      });
    }

    const lines = menuItems.map(m => 
      `${m.name} — ${(m.price_cents / 100).toFixed(2)} zł`
    ).join('\n');

    return res.json({
      sessionInfo: { parameters: { restaurant_id, sizes_map: {} } },
      fulfillment_response: { 
        messages: [{ text: { text: [lines + "\nJaki rozmiar?"] } }] 
      }
    });
  } catch (e) {
    console.error('listMenu error:', e);
    return res.json({ 
      fulfillment_response: { 
        messages: [{ text: { text: ["Błąd serwera."] } }] 
      } 
    });
  }
}

// Tworzenie zamówienia
async function createOrder(req, res) {
  const params = req.body?.sessionInfo?.parameters || {};
  const qty = Number(params.qty || params.number || 1);
  const restaurant_id = params.restaurant_id;
  const item_name = params.food_item || params.dish || "";
  
  console.log('🛒 CREATE ORDER - restaurant_id:', restaurant_id, 'item:', item_name, 'qty:', qty);
  
  if (!restaurant_id || !item_name) {
    return res.json({ 
      fulfillment_response: { 
        messages: [{ text: { text: ["Brak kompletnych danych zamówienia."] } }] 
      } 
    });
  }

  try {
    // Znajdź pozycję menu
    const { data: menuItem, error: menuError } = await supabase
      .from("menu_items")
      .select("id, name, price_cents, restaurant_id")
      .eq("restaurant_id", restaurant_id)
      .ilike("name", `%${item_name}%`)
      .single();

    if (menuError || !menuItem) {
      console.error('Menu item error:', menuError);
      return res.json({ 
        fulfillment_response: { 
          messages: [{ text: { text: ["Nie znalazłem tej pozycji w menu."] } }] 
        } 
      });
    }

    const subtotal = menuItem.price_cents * qty;
    const eta = "15–20 min";

    // Utwórz zamówienie
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .insert({
        restaurant_id: restaurant_id,
        subtotal_cents: subtotal,
        total_cents: subtotal,
        status: "new",
        eta: eta
      })
      .select("id, eta, total_cents")
      .single();

    if (orderError) {
      console.error('Order creation error:', orderError);
      return res.json({ 
        fulfillment_response: { 
          messages: [{ text: { text: ["Błąd tworzenia zamówienia."] } }] 
        } 
      });
    }

    // Dodaj pozycje zamówienia
    await supabase.from("order_items").insert({
      order_id: order.id,
      menu_item_id: menuItem.id,
      name: menuItem.name,
      unit_price_cents: menuItem.price_cents,
      qty: qty
    });

    // Dodaj event
    await supabase.from("order_events").insert({
      order_id: order.id,
      event: "created",
      note: "Zamówienie utworzone"
    });

    const priceTotal = (order.total_cents / 100).toFixed(2).replace('.', ',') + ' zł';
    const itemsSummary = `${qty}× ${menuItem.name}`;

    return res.json({
      sessionInfo: { 
        parameters: { 
          order_id: order.id, 
          eta: order.eta, 
          price_total: priceTotal,
          items_summary: itemsSummary
        } 
      },
      fulfillment_response: { 
        messages: [{ 
          text: { 
            text: [`Zamówienie #${order.id} przyjęte: ${itemsSummary}. Suma: ${priceTotal}. Czas: ${order.eta}.`] 
          } 
        }] 
      }
    });
  } catch (e) {
    console.error('createOrder error:', e);
    return res.json({ 
      fulfillment_response: { 
        messages: [{ text: { text: ["Błąd serwera."] } }] 
      } 
    });
  }
}

const supabase = createClient(
  process.env.SUPABASE_URL || 'https://ezemaacyyvbpjlagchds.supabase.co',
  process.env.SUPABASE_ANON_KEY || 'sb_publishable_-i5RiddgTH3Eh9-6xuJ7wQ_KjuredAu'
);

// Dialogflow setup - use YOUR agent project ID
const projectId = process.env.GOOGLE_PROJECT_ID || 'civic-polymer-470119-j2';

// Use Vercel environment credentials (recommended for production)
let sessionClient;

console.log('🔍 Environment check:');
console.log('- GOOGLE_APPLICATION_CREDENTIALS_JSON exists:', !!process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
console.log('- GOOGLE_APPLICATION_CREDENTIALS_BASE64 exists:', !!process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64);
console.log('- GOOGLE_API_KEY exists:', !!process.env.GOOGLE_API_KEY);
console.log('- Project ID:', projectId);

if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
  // Production: Use Vercel environment variable (JSON)
  console.log('✅ Using Vercel environment credentials (JSON)');
  const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
  sessionClient = new SessionsClient({ credentials, projectId });
} else if (process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64) {
  // Production: Use Vercel environment variable (Base64)
  console.log('✅ Using Vercel environment credentials (Base64)');
  const credentialsJson = Buffer.from(process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64, 'base64').toString('utf8');
  const credentials = JSON.parse(credentialsJson);
  sessionClient = new SessionsClient({ credentials, projectId });
} else if (process.env.GOOGLE_CREDENTIALS_PART1 && process.env.GOOGLE_CREDENTIALS_PART2) {
  // Production: Use Vercel environment variable (Split JSON)
  console.log('✅ Using Vercel environment credentials (Split)');
  const credentialsJson = process.env.GOOGLE_CREDENTIALS_PART1 + process.env.GOOGLE_CREDENTIALS_PART2;
  const credentials = JSON.parse(credentialsJson);
  sessionClient = new SessionsClient({ credentials, projectId });
} else if (process.env.GOOGLE_API_KEY) {
  // Fallback: Use API Key
  console.log('🔑 Using Google API Key');
  sessionClient = new SessionsClient({ 
    apiKey: process.env.GOOGLE_API_KEY,
    projectId 
  });
} else {
  // Local development fallback
  console.log('⚠️ Using local service account - tylko do testów lokalnych!');
  sessionClient = new SessionsClient({ 
    keyFilename: './service-account.json',
    projectId 
  });
}

// Helper functions for CORS
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours
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
      const { text, lang = 'pl-PL', voiceName, gender, audioEncoding = 'MP3' } = req.body;

      if (!text) {
        return res.status(400).json({ 
          error: 'Missing text parameter' 
        });
      }

      console.log('🎤 TTS Request:', { text: text.substring(0, 100) + '...', lang, voiceName, gender });

      // Import TTS handler dynamically to avoid circular imports
      const ttsHandler = (await import('./tts.js')).default;
      return await ttsHandler(req, res);
      
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
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { text, sessionId = 'default-session' } = req.body;
    
    if (!text) {
      res.status(400).json({ error: 'Text is required' });
      return;
    }

    console.log('📝 Dialogflow input:', text);
    console.log('🔑 Session client exists:', !!sessionClient);

    // Create session path
    const sessionPath = sessionClient.projectAgentSessionPath(projectId, sessionId);

    // The text query request
    const request = {
      session: sessionPath,
      queryInput: {
        text: {
          text: text,
          languageCode: 'pl-PL',
        },
      },
    };

    console.log('🔄 Sending to Dialogflow...');
    
    // Send request to Dialogflow
    const [response] = await sessionClient.detectIntent(request);
    
    console.log('🤖 Dialogflow raw response:', JSON.stringify(response, null, 2));
    
    const result = response.queryResult;
    
    const formattedResponse = {
      fulfillmentText: result.fulfillmentText || 'Nie rozumiem. Spróbuj ponownie.',
      intent: result.intent ? result.intent.displayName : 'unknown',
      confidence: result.intentDetectionConfidence || 0,
      parameters: result.parameters || {},
      allRequiredParamsPresent: result.allRequiredParamsPresent || false,
      timestamp: new Date().toISOString(),
      sessionId
    };

    console.log('✅ Formatted Dialogflow response:', formattedResponse);
    res.status(200).json(formattedResponse);
    
  } catch (error) {
    console.error('❌ Dialogflow error:', error);
    
    // Fallback response in case of Dialogflow failure
    const fallbackResponse = {
      fulfillmentText: 'Przepraszam, wystąpił problem z rozpoznawaniem mowy. Spróbuj ponownie.',
      intent: 'error.fallback',
      confidence: 0,
      error: error.message,
      timestamp: new Date().toISOString()
    };
    
    res.status(500).json(fallbackResponse);
  }
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
            '/api/dialogflow-webhook',
            '/api/restaurants',
            '/api/menu',
            '/api/orders',
            '/api/search',
            '/api/places',
            '/api/amber'
          ]
        });
      case 'dialogflow-freeflow':
        return handleDialogflowWebhook(req, res);
      case 'amber':
        return handleAmberBrain(req, res);
      default:
        return res.status(404).json({ error: 'Not found' });
    }
  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      detail: error.message 
    });
  }
}
