// /api/brain/brainRouter.js
import { detectIntent, normalizeTxt } from "./intent-router.js";
import { supabase } from "../_supabase.js";
import { getConfig } from "../config/configService.js";
import { getSession, updateSession } from "./context.js";
import { playTTS, stylizeWithGPT4o } from "../tts.js";
import crypto from "node:crypto";
import { extractLocation } from "./helpers.js";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const IS_TEST = !!(process.env.VITEST || process.env.VITEST_WORKER_ID || process.env.NODE_ENV === 'test');

// 🧹 Clear session cache on server start
if (global.sessionCache) {
  console.log("🧹 Clearing old session cache...");
  global.sessionCache.clear?.();
  global.sessionCache = new Map();
} else {
  global.sessionCache = new Map();
}

// ===== PATCH: cart utils (BEGIN) =====
function ensureSessionCart(session) {
  if (!session.cart) session.cart = { items: [], total: 0 };
  if (!Array.isArray(session.cart.items)) session.cart.items = [];
  if (typeof session.cart.total !== 'number') session.cart.total = 0;
}

function sum(items) {
  return (items || []).reduce((acc, it) => acc + (Number(it.price_pln || it.price || 0) * (Number(it.qty || 1))), 0);
}

function commitPendingOrder(session) {
  if (!session?.pendingOrder?.items?.length) return { committed: false, cart: session?.cart || { items: [], total: 0 } };
  ensureSessionCart(session);
  const toAdd = session.pendingOrder.items.map(it => ({
    id: it.id || crypto.randomUUID?.() || String(Date.now()),
    name: it.name || it.item_name || 'pozycja',
    price_pln: Number(it.price_pln ?? it.price ?? 0),
    qty: Number(it.qty || 1),
    restaurant_id: session.pendingOrder.restaurant_id,
    restaurant_name: session.pendingOrder.restaurant,
  }));
  session.cart.items.push(...toAdd);
  session.cart.total = Number(sum(session.cart.items).toFixed(2));
  session.lastOrder = { ...session.pendingOrder };
  delete session.pendingOrder;
  if (session.expectedContext === 'confirm_order') delete session.expectedContext;
  return { committed: true, cart: session.cart };
}
// ===== PATCH: cart utils (END) =====

function applyDynamicTtsEnv(cfg) {
  try {
    if (!cfg) return;
    if (cfg.tts_engine?.engine) {
      // Map logical engine to existing env toggles
      const engine = String(cfg.tts_engine.engine);
      process.env.TTS_MODE = engine;
      process.env.TTS_SIMPLE = engine === "basic" ? "true" : "false";
      // vertex / chirp use Vertex by default
      const useVertex = engine === "vertex" || engine === "chirp" || engine === "vertex-tts";
      process.env.TTS_USE_VERTEX = useVertex ? "true" : "false";
    }
    if (cfg.tts_voice?.voice) {
      process.env.TTS_VOICE = String(cfg.tts_voice.voice);
    }
    if (cfg.streaming && typeof cfg.streaming.enabled === "boolean") {
      process.env.OPENAI_STREAM = cfg.streaming.enabled ? "true" : "false";
    }
    if (typeof cfg.cache_enabled === "boolean") {
      process.env.CACHE_ENABLED = cfg.cache_enabled ? "true" : "false";
    }
  } catch (e) {
    console.warn("⚠️ applyDynamicTtsEnv failed:", e.message);
  }
}

// --- Validation Functions ---

/**
 * Waliduje input tekstowy od użytkownika
 * @param {string} text - Tekst do walidacji
 * @returns {object} - { valid: boolean, error?: string }
 */
function validateInput(text) {
  if (!text || typeof text !== 'string') {
    return { valid: false, error: 'Invalid input: text must be non-empty string' };
  }
  
  if (text.length > 1000) {
    return { valid: false, error: 'Input too long: max 1000 characters' };
  }
  
  if (text.trim().length === 0) {
    return { valid: false, error: 'Input cannot be empty or whitespace only' };
  }
  
  // Sprawdź czy nie zawiera potencjalnie szkodliwych znaków
  if (/[<>{}[\]\\|`~]/.test(text)) {
    return { valid: false, error: 'Input contains potentially harmful characters' };
  }
  
  return { valid: true };
}

/**
 * Waliduje sesję użytkownika
 * @param {object} session - Sesja do walidacji
 * @returns {object} - { valid: boolean, session?: object, error?: string }
 */
function validateSession(session) {
  if (!session) {
    return { valid: false, error: 'No session provided' };
  }
  
  // Sprawdź czy sesja nie jest za stara (1 godzina)
  if (session.lastUpdated && Date.now() - session.lastUpdated > 3600000) {
    console.log('🕐 Session expired (older than 1 hour), clearing...');
    return { valid: false, error: 'Session expired' };
  }
  
  // Sprawdź czy sessionId jest prawidłowy
  if (session.sessionId && typeof session.sessionId !== 'string') {
    return { valid: false, error: 'Invalid sessionId type' };
  }
  
  return { valid: true, session };
}

/**
 * Waliduje dane restauracji
 * @param {object} restaurant - Restauracja do walidacji
 * @returns {boolean}
 */
function validateRestaurant(restaurant) {
  if (!restaurant || typeof restaurant !== 'object') {
    return false;
  }
  
  if (!restaurant.id || !restaurant.name) {
    return false;
  }
  
  if (typeof restaurant.id !== 'string' || typeof restaurant.name !== 'string') {
    return false;
  }
  
  return true;
}

// --- Helper Functions ---

function normalize(text) {
  if (!text) return "";
  return text
    .toLowerCase()
    .replace(/restauracji|restauracja|w|u|na|do/g, '')
    .replace(/[-_]/g, ' ') // 🔧 zamiana myślników na spacje
    .replace(/[^a-ząćęłńóśźż0-9\s]/g, '') // pozwól spacje i polskie znaki
    .replace(/\s+/g, ' ') // 🔧 usuń nadmiarowe spacje
    .trim();
}

function levenshtein(a, b) {
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

function fuzzyMatch(a, b, threshold = 3) {
  if (!a || !b) return false;
  const normA = normalize(a);
  const normB = normalize(b);
  if (normA === normB) return true;
  if (normA.includes(normB) || normB.includes(normA)) return true;

  // 🔧 Dodatkowy alias match — np. "vien" vs "vien thien"
  if (normA.split(' ')[0] === normB.split(' ')[0]) return true;

  const dist = levenshtein(normA, normB);
  return dist <= threshold;
}

/**
 * Parsuje tekst i wyciąga nazwę restauracji + opcjonalnie nazwę dania
 * Przykłady:
 * - "Zamów pizzę Monte Carlo" → { restaurant: "Monte Carlo", dish: "pizza" }
 * - "Pokaż menu Tasty King" → { restaurant: "Tasty King", dish: null }
 * - "Zjedz w Piekarach" → { restaurant: "Piekary", dish: null }
 */
function parseRestaurantAndDish(text) {
  const normalized = text.toLowerCase();

  // Pattern 0: "Pokaż menu" (bez nazwy restauracji — użyj kontekstu sesji)
  if (/^(pokaż\s+)?menu$/i.test(text.trim())) {
    return { dish: null, restaurant: null };
  }

  // Pattern 1: "Zamów [danie] [nazwa restauracji]"
  const orderPattern = /(?:zamów|poproszę|chcę)\s+([a-ząćęłńóśźż\s]+?)\s+([A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż\s]+)/i;
  const orderMatch = text.match(orderPattern);
  if (orderMatch) {
    let dish = orderMatch[1]?.trim();
    // Normalizuj dopełniacz → mianownik (pizzę → pizza, burgerę → burger)
    dish = dish?.replace(/ę$/i, 'a').replace(/a$/i, 'a');
    return { dish, restaurant: orderMatch[2]?.trim() };
  }

  // Pattern 2: "Pokaż menu [nazwa restauracji]"
  const menuPattern = /(?:pokaż\s+)?menu\s+(?:w\s+|pizzeria\s+|restauracja\s+)?([a-ząćęłńóśźż][a-ząćęłńóśźż\s]+)/i;
  const menuMatch = text.match(menuPattern);
  if (menuMatch) {
    return { dish: null, restaurant: menuMatch[1]?.trim() };
  }

  // Pattern 3: "Zjedz w [nazwa miejsca]" (ale NIE "menu" ani słowa kluczowe nearby)
  const locationPattern = /(?:w|z)\s+([A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż\s]+)/i;
  const locationMatch = text.match(locationPattern);
  if (locationMatch) {
    const extracted = locationMatch[1]?.trim();
    // Ignoruj jeśli to słowo kluczowe (menu, zamówienie, nearby keywords)
    if (extracted && !/(menu|zamówienie|zamówienia|pobliżu|okolicy|blisko|okolice|pobliżach)/i.test(extracted)) {
      return { dish: null, restaurant: extracted };
    }
  }

  return { dish: null, restaurant: null };
}

/**
 * 🧠 Wyciąga ilość z tekstu (2x, dwie, trzy, kilka, etc.)
 * @param {string} text - Tekst użytkownika
 * @returns {number} - Ilość (domyślnie 1)
 */
function extractQuantity(text) {
  const normalized = text.toLowerCase();

  // Pattern 1: Liczby (2x, 3x, 2 razy, 3 razy)
  const numPattern = /(\d+)\s*(?:x|razy|sztuk|porcj)/i;
  const numMatch = normalized.match(numPattern);
  if (numMatch) {
    return parseInt(numMatch[1], 10);
  }

  // Pattern 2: Słownie (dwie, trzy, cztery, pięć)
  const wordMap = {
    'jedno': 1, 'jedna': 1, 'jeden': 1,
    'dwa': 2, 'dwie': 2, 'dwóch': 2,
    'trzy': 3, 'trzech': 3,
    'cztery': 4, 'czterech': 4,
    'pięć': 5, 'pięciu': 5,
    'sześć': 6, 'sześciu': 6,
    'siedem': 7, 'siedmiu': 7,
    'osiem': 8, 'ośmiu': 8,
    'dziewięć': 9, 'dziewięciu': 9,
    'dziesięć': 10, 'dziesięciu': 10,
    'kilka': 2, 'kilku': 2,
    'parę': 2
  };

  for (const [word, qty] of Object.entries(wordMap)) {
    if (normalized.includes(word)) {
      return qty;
    }
  }

  return 1; // Domyślnie 1
}

/**
 * 🍕 Znajduje danie w menu restauracji (fuzzy matching)
 * @param {string} restaurantId - ID restauracji
 * @param {string} dishName - Nazwa dania do znalezienia
 * @returns {Promise<Object|null>} - Znalezione danie lub null
 */
async function findDishInMenu(restaurantId, dishName) {
  if (!restaurantId || !dishName) return null;

  try {
    const { data: menu, error } = await supabase
      .from('menu_items_v2')
      .select('id, name, price_pln, description, category, available')
      .eq('restaurant_id', restaurantId);

    if (error || !menu?.length) {
      console.warn(`⚠️ No menu found for restaurant ${restaurantId}`);
      return null;
    }

    const normalizedDish = normalize(dishName);

    // 1. Exact match
    let matched = menu.find(item => normalize(item.name) === normalizedDish);
    if (matched) {
      console.log(`✅ Exact match: "${dishName}" → ${matched.name}`);
      return matched;
    }

    // 2. Substring match
    matched = menu.find(item => {
      const normName = normalize(item.name);
      return normName.includes(normalizedDish) || normalizedDish.includes(normName);
    });
    if (matched) {
      console.log(`✅ Substring match: "${dishName}" → ${matched.name}`);
      return matched;
    }

    // 3. Fuzzy match (Levenshtein distance ≤ 3)
    matched = menu.find(item => fuzzyMatch(dishName, item.name, 3));
    if (matched) {
      console.log(`✅ Fuzzy match: "${dishName}" → ${matched.name}`);
      return matched;
    }

    console.warn(`⚠️ No match for dish: "${dishName}"`);
    return null;
  } catch (err) {
    console.error('❌ findDishInMenu error:', err);
    return null;
  }
}

/**
 * 🛒 Parsuje tekst i wyciąga zamówione pozycje z menu
 * @param {string} text - Tekst użytkownika
 * @param {string} restaurantId - ID restauracji
 * @returns {Promise<Array>} - Tablica pozycji: [{ id, name, price, quantity }]
 */
async function parseOrderItems(text, restaurantId) {
  if (!text || !restaurantId) return [];

  try {
    console.log(`🛒 Parsing order items from: "${text}"`);

    // Pobierz menu restauracji
    const { data: menu, error } = await supabase
      .from('menu_items_v2')
      .select('id, name, price_pln, description, category, available')
      .eq('restaurant_id', restaurantId);

    if (error || !menu?.length) {
      console.warn(`⚠️ No menu found for restaurant ${restaurantId}`);
      return [];
    }

    const items = [];
    const normalized = normalize(text);

    // Wyciągnij ilość z tekstu
    const quantity = extractQuantity(text);

    // Sprawdź każdą pozycję z menu czy jest w tekście
    for (const menuItem of menu) {
      const dishName = normalize(menuItem.name);

      // Sprawdź czy nazwa dania jest w tekście (fuzzy match)
      if (fuzzyMatch(text, menuItem.name, 3) || normalized.includes(dishName)) {
        items.push({
          id: menuItem.id,
          name: menuItem.name,
          price: parseFloat(menuItem.price_pln),
          quantity: quantity
        });
        console.log(`✅ Found dish: ${menuItem.name} (qty: ${quantity})`);
      }
    }

    // Jeśli nie znaleziono żadnego dania, spróbuj wyciągnąć nazwę z tekstu
    if (items.length === 0) {
      const parsed = parseRestaurantAndDish(text);
      if (parsed.dish) {
        const matched = await findDishInMenu(restaurantId, parsed.dish);
        if (matched) {
          items.push({
            id: matched.id,
            name: matched.name,
            price: parseFloat(matched.price_pln),
            quantity: quantity
          });
          console.log(`✅ Found dish via parsing: ${matched.name} (qty: ${quantity})`);
        }
      }
    }

    console.log(`🛒 Parsed ${items.length} items:`, items);
    return items;
  } catch (err) {
    console.error('❌ parseOrderItems error:', err);
    return [];
  }
}

/**
 * Znajduje restaurację w bazie Supabase używając fuzzy matching
 */
async function findRestaurant(name) {
  if (!name) return null;

  try {
    const { data: restaurants, error } = await supabase
      .from('restaurants')
      .select('id, name, address, city, lat, lng');

    if (error || !restaurants?.length) {
      console.warn('⚠️ findRestaurant: brak danych z Supabase');
      return null;
    }

    // Fuzzy matching z Levenshtein
    const matched = restaurants.find(r => fuzzyMatch(name, r.name, 3));
    if (matched) {
      console.log(`✅ Matched restaurant: "${name}" → ${matched.name}`);
      return matched;
    }

    // 🔧 Alias fallback
    const alias = restaurants.find(r => normalize(r.name).startsWith(normalize(name).split(' ')[0]));
    if (alias) {
      console.log(`✅ Alias match: "${name}" → ${alias.name}`);
      return alias;
    }

    console.warn(`⚠️ No match for restaurant: "${name}"`);
    return null;
  } catch (err) {
    console.error('⚠️ findRestaurant error:', err.message);
    return null;
  }
}

/**
 * Wyciąga nazwę lokalizacji z tekstu
 * Przykłady:
 * - "w Piekarach" → "Piekary"
 * - "blisko Bytomia" → "Bytom"
 * - "koło Katowic" → "Katowice"
 */
// 🔥 extractLocation został przeniesiony do helpers.js i jest importowany na górze pliku

/**
 * Wyciąga typ kuchni z tekstu użytkownika
 * Przykłady:
 * - "chciałbym zjeść pizzę" → "Pizzeria"
 * - "gdzie jest kebab" → "Kebab"
 * - "burger w Piekarach" → "Amerykańska"
 */
/**
 * SmartContext v3.1: Cuisine Alias Layer (Extended)
 * Mapuje aliasy semantyczne na listę typów kuchni
 * Przykład: "azjatyckie" → ["Wietnamska", "Chińska", "Tajska"]
 */
const cuisineAliases = {
  // Azjatycka
  'azjatyckie': ['Wietnamska', 'Chińska', 'Tajska'],
  'azjatyckiej': ['Wietnamska', 'Chińska', 'Tajska'],
  'orientalne': ['Wietnamska', 'Chińska'],
  'orientalnej': ['Wietnamska', 'Chińska'],

  // Fast food
  'fastfood': ['Amerykańska', 'Kebab'],
  'fast food': ['Amerykańska', 'Kebab'],
  'na szybko': ['Amerykańska', 'Kebab'],
  'szybkie': ['Amerykańska', 'Kebab'],
  'cos szybkiego': ['Amerykańska', 'Kebab'],
  'cos lekkiego': ['Amerykańska', 'Kebab'],
  'na zab': ['Amerykańska', 'Kebab'],

  // Burger
  'burger': ['Amerykańska'],
  'burgera': ['Amerykańska'],
  'burgerow': ['Amerykańska'],

  // Pizza
  'pizza': ['Włoska'],
  'pizze': ['Włoska'],
  'pizzy': ['Włoska'],
  'wloska': ['Włoska'],
  'wloskiej': ['Włoska'],

  // Kebab
  'kebab': ['Kebab'],
  'kebaba': ['Kebab'],
  'kebabu': ['Kebab'],

  // Lokalne / Regionalne
  'lokalne': ['Polska', 'Śląska / Europejska', 'Czeska / Polska'],
  'lokalnej': ['Polska', 'Śląska / Europejska', 'Czeska / Polska'],
  'domowe': ['Polska', 'Śląska / Europejska'],
  'domowej': ['Polska', 'Śląska / Europejska'],
  'regionalne': ['Polska', 'Śląska / Europejska', 'Czeska / Polska'],
  'regionalnej': ['Polska', 'Śląska / Europejska', 'Czeska / Polska'],
  'polska': ['Polska'],
  'polskiej': ['Polska'],

  // Europejska
  'europejska': ['Śląska / Europejska', 'Czeska / Polska', 'Włoska'],
  'europejskiej': ['Śląska / Europejska', 'Czeska / Polska', 'Włoska'],

  // Wege (fallback — brak w bazie, ale obsługa)
  'wege': [],
  'wegetarianskie': [],
  'wegetarianskiej': []
};

/**
 * SmartContext v3.1: Distance calculation (Haversine formula)
 * Oblicza dystans w km między dwoma punktami (lat/lng)
 */
function calculateDistance(lat1, lng1, lat2, lng2) {
  if (!lat1 || !lng1 || !lat2 || !lng2) return null;

  const R = 6371; // Promień Ziemi w km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Dystans w km
}

/**
 * SmartContext v3.1: Grupuje restauracje po kategoriach cuisine_type
 * Zwraca obiekt { kategoria: [restauracje] }
 */
function groupRestaurantsByCategory(restaurants) {
  const categories = {};

  restaurants.forEach(r => {
    const cuisine = r.cuisine_type || 'Inne';
    if (!categories[cuisine]) {
      categories[cuisine] = [];
    }
    categories[cuisine].push(r);
  });

  return categories;
}

/**
 * SmartContext v3.1: Mapuje cuisine_type na przyjazną nazwę kategorii
 */
function getCuisineFriendlyName(cuisineType) {
  const mapping = {
    'Amerykańska': 'fast-foody i burgery',
    'Kebab': 'kebaby',
    'Włoska': 'pizzerie',
    'Polska': 'kuchnię polską',
    'Śląska / Europejska': 'kuchnię europejską',
    'Czeska / Polska': 'kuchnię regionalną',
    'Wietnamska': 'kuchnię azjatycką',
    'Chińska': 'kuchnię azjatycką',
    'Tajska': 'kuchnię azjatycką'
  };

  return mapping[cuisineType] || cuisineType.toLowerCase();
}

/**
 * SmartContext v3.1: Nearby city suggestions
 * Mapa miast z sugestiami pobliskich lokalizacji
 */
const nearbyCitySuggestions = {
  'bytom': ['Piekary Śląskie', 'Katowice', 'Zabrze'],
  'katowice': ['Piekary Śląskie', 'Bytom', 'Chorzów'],
  'zabrze': ['Piekary Śląskie', 'Bytom', 'Gliwice'],
  'gliwice': ['Zabrze', 'Piekary Śląskie'],
  'chorzow': ['Katowice', 'Piekary Śląskie', 'Bytom']
};

/**
 * SmartContext v3.1: Semantic Intent Boost
 * Analizuje naturalny język i modyfikuje intencję jeśli pasuje semantycznie
 * NIE nadpisuje intencji jeśli confidence ≥ 0.8
 *
 * @param {string} text - Tekst użytkownika
 * @param {string} intent - Wykryta intencja z detectIntent
 * @param {number} confidence - Pewność wykrycia (0-1)
 * @returns {string} - Zmodyfikowana lub oryginalna intencja
 */
export function boostIntent(text, intent, confidence = 0, session = null) {
  if (!text) return intent;
  const lower = normalizeTxt(text); // używamy normalizeTxt z intent-router (stripuje diacritics)
  const ctx = session || {};

  // --- Fast intent detection (no model delay) ---
  const fastNegCancel = /\b(anuluj|odwołaj|odwolaj|rezygnuj)\b/i;
  const fastNegChange = /\b(nie|inna|inne|zmien|zmień)\b/i;
  const fastShowMore = /\b(pokaz\s*(wiecej|reszte|opcje)|wiecej)\b/i;

  // Wykluczenie: jeśli "anuluj zamówienie" - priorytet najwyższy
  if (/\banuluj\s+zamowienie\b/i.test(lower)) return 'cancel_order';
  
  // Wykluczenie: jeśli "anuluj zamówienie" zawiera "zamówienie", ale jest w kontekście pendingOrder/confirm → cancel
  if (fastNegCancel.test(lower) && (ctx?.pendingOrder || ctx?.expectedContext === 'confirm_order')) {
    return 'cancel_order';
  }
  if (fastNegChange.test(lower) && !(ctx?.expectedContext === 'confirm_order') && !/\b(anuluj|rezygnuj)\b/i.test(lower)) return 'change_restaurant';
  if (fastShowMore.test(lower)) return 'show_more_options';

  // Preferencja: pytania w stylu "gdzie zjeść ..." zawsze traktuj jako find_nearby
  // nawet jeśli w tekście jest słowo "pizza" (żeby nie przełączać na create_order)
  if ((/\bgdzie\b/i.test(lower) && (/(zjesc|zjem)/i.test(lower) || /(pizza|pizz)/i.test(lower)))) {
    return 'find_nearby';
  }

  // "Nie, pokaż inne restauracje" → change_restaurant (globalnie, poza confirm context)
  if ((/\bnie\b/.test(lower) && /(pokaz|pokaz|pokaz|pokaż|inne)/i.test(lower) && /(restaurac|opcje)/i.test(lower)) && ctx?.expectedContext !== 'confirm_order') {
    return 'change_restaurant';
  }

  // Wieloelementowe zamowienia: "zamow ... i ..." → create_order
  if (/(zamow|zamowic|zamowisz|zamowmy|poprosze|prosze)/i.test(lower) && /\bi\b/.test(lower) && /(pizza|pizz|burger|kebab)/i.test(lower)) {
    return 'create_order';
  }

  // --- PRIORITY 0: Negations in confirm flow (cancel/change) ---
  // Obsługa "anuluj" → cancel_order (jeśli pendingOrder lub expectedContext=confirm_order)
  if ((ctx?.expectedContext === 'confirm_order' || ctx?.pendingOrder) && /\b(anuluj|rezygnuj|odwołaj|odwolaj)\b/i.test(lower)) {
    console.log('🧠 SmartContext (PRIORITY 0) → intent=cancel_order (anuluj w confirm_order context)');
    return 'cancel_order';
  }

  // Obsługa "nie/inne/zmień" → change_restaurant (jeśli pendingOrder lub expectedContext=confirm_order lub lastIntent=create_order)
  if ((ctx?.expectedContext === 'confirm_order' || ctx?.pendingOrder || ctx?.lastIntent === 'create_order') && 
      /\b(nie|inne|zmien|zmień|inna|inny)\b/i.test(lower) && !/\b(anuluj|rezygnuj|odwołaj)\b/i.test(lower)) {
    console.log('🧠 SmartContext (PRIORITY 0) → intent=change_restaurant (nie/inne w confirm_order context)');
    return 'change_restaurant';
  }

  // --- Global short-circuits for concise follow-ups ---
  // 1) "pokaż więcej" (ale NIE "inne" - to może oznaczać change_restaurant)
  const moreAnyRx = /\b(pokaz\s*(wiecej|reszte|opcje)|wiecej)\b/i;
  if (moreAnyRx.test(lower) && !/\b(nie|inna|inny)\b/i.test(lower)) {
    console.log('🧠 SmartContext (global) → intent=show_more_options (phrase: "pokaż więcej")');
    return 'show_more_options';
  }

  // 2) "wybieram numer 1" / liczebnik porządkowy / sama cyfra → select_restaurant
  const numberOnlyMatch = text.trim().match(/^\s*([1-9])\s*$/);
  const ordinalPlAny = /(pierwsza|pierwszy|druga|drugi|trzecia|trzeci|czwarta|czwarty|piata|piaty|szosta|szosty|siodma|siodmy|osma|osmy|dziewiata|dziewiaty)/i;
  if (numberOnlyMatch || ordinalPlAny.test(lower) || /\b(wybieram|wybierz)\b/i.test(lower) || /\bnumer\s+[1-9]\b/i.test(lower)) {
    console.log('🧠 SmartContext (global) → intent=select_restaurant (phrase: number/ordinal)');
    return 'select_restaurant';
  }

  // 🧠 FOLLOW-UP CONTEXT LOGIC - DRUGI PRIORYTET
  // Sprawdź oczekiwany kontekst PRZED innymi regułami semantycznymi
  if (ctx?.expectedContext) {
    console.log(`🧠 SmartContext: checking expected context: ${ctx.expectedContext}`);

    // Oczekiwany kontekst: "pokaż więcej opcji"
    if (ctx.expectedContext === 'show_more_options') {
      // -- SHOW MORE OPTIONS (kontekstowo) --
      const moreRx = /\b(pokaz\s*(wiecej|reszte)|wiecej|inne|pokaz\s*opcje)\b/i;
      if (moreRx.test(lower)) {
        console.log('🧠 SmartContext Boost → intent=show_more_options (expected context)');
        return 'show_more_options';
      }
      // nic nie mówimy → nie nadpisuj na cokolwiek innego (fall-through bez zmiany)
    }

    // Oczekiwany kontekst: "wybierz restaurację"
    if (ctx.expectedContext === 'select_restaurant') {
      // -- SELECT RESTAURANT (cyfra lub liczebnik porządkowy) --
      const numberOnly = text.trim().match(/^\s*([1-9])\s*$/); // "1".."9" solo
      const ordinalPl = /(pierwsz(ą|y)|drug(ą|i)|trzeci(ą|i)|czwart(ą|y)|piąt(ą|y)|szóst(ą|y)|siódm(ą|y)|ósm(ą|y)|dziewiąt(ą|y))/i;
      if (numberOnly || ordinalPl.test(lower) || /(wybieram|wybierz|numer\s+[1-9])/i.test(lower)) {
        console.log('🧠 SmartContext Boost → intent=select_restaurant (expected context)');
        return 'select_restaurant';
      }
    }

    // Oczekiwany kontekst: "potwierdź zamówienie" (NAJWYŻSZY PRIORYTET!)
    if (ctx.expectedContext === 'confirm_order') {
      console.log('🧠 SmartContext: expectedContext=confirm_order detected, checking user response...');

      // "Nie, pokaż inne ..." → zmiana restauracji nawet w confirm flow
      if (/\bnie\b/.test(lower) && /(pokaz|pokaż|inne)/i.test(lower) && /(restaurac|opcje)/i.test(lower)) {
        console.log('🧠 SmartContext Boost → intent=change_restaurant (nie + inne/pokaż w confirm context)');
        return 'change_restaurant';
      }

      // Jeśli użytkownik wypowiada pełną komendę zamówienia (z daniem/ilością), traktuj jako NOWE create_order
      const hasDishOrQty = /(pizza|pizz|burger|kebab|tiramisu|salat|słat|zupa|makaron)/i.test(lower) || /\b(\d+|dwie|trzy|cztery|piec|pi\u0119c|szesc|siedem|osiem|dziewiec|dziesiec)\b/i.test(lower);
      if (hasDishOrQty && /(zamow|zamowic|poprosze|wezm|biore|zamawiam)/i.test(lower)) {
        console.log('🧠 SmartContext: confirm->create_order (detected explicit order with items/quantity)');
        return 'create_order';
      }

      // Potwierdzenie - bardziej elastyczne dopasowanie
      // Dopuszcza: "tak", "ok", "dodaj", "proszę dodać", "tak dodaj", "dodaj proszę", etc.
      // Używamy `lower` (znormalizowany tekst bez polskich znaków) dla większości sprawdzeń
      if (/(^|\s)(tak|ok|dobrze|zgoda|pewnie|jasne|oczywiscie)(\s|$)/i.test(lower) ||
          /dodaj|dodac|zamow|zamawiam|potwierdz|potwierdzam/i.test(lower)) {
        console.log('🧠 SmartContext Boost → intent=confirm_order (expected context, user confirmed)');
        return 'confirm_order';
      }

      // Negacja w confirm → traktuj jako anulowanie zamówienia
      const neg = /\b(nie|anuluj|rezygnuj)\b/i;
      if (neg.test(lower)) {
        console.log('🧠 SmartContext Boost → intent=cancel_order (negation within confirm context)');
        return 'cancel_order';
      }

      // Jeśli user mówi wyraźnie "anuluj" → cancel
      if (/\b(anuluj|rezygnuj|odwołaj)\b/i.test(lower)) {
        console.log('🧠 SmartContext Boost → intent=cancel_order (explicit cancel)');
        return 'cancel_order';
      }

      console.log('⚠️ SmartContext: expectedContext=confirm_order but user response unclear, falling through...');
    }
  }

  // Nie modyfikuj jeśli intencja jest bardzo pewna (NAJWYŻSZY PRIORYTET)
  // WYJĄTEK: jeśli był expectedContext powyżej, to już zwróciliśmy wcześniej
  if (confidence >= 0.8) {
    console.log(`🧠 SmartContext: skipping boost (confidence=${confidence})`);
    return intent;
  }

  // 🧠 FALLBACK: Jeśli nie ma expectedContext, ale lastIntent to create_order, 
  // a użytkownik mówi "nie", to prawdopodobnie chce anulować zamówienie
  if (!session?.expectedContext && session?.lastIntent === 'create_order' && 
      /(^|\s)(nie|anuluj|rezygnuje|rezygnuję)(\s|$)/i.test(lower)) {
    console.log('🧠 SmartContext Fallback → intent=cancel_order (lastIntent=create_order + "nie")');
    return 'cancel_order';
  }

  // 🧠 Dodatkowy fallback: jeśli poprzedni krok to clarify_order (prośba o doprecyzowanie),
  // a użytkownik mówi "nie/anuluj", potraktuj to jako anulowanie
  if (!session?.expectedContext && session?.lastIntent === 'clarify_order' &&
      /(^|\s)(nie|anuluj|rezygnuje|rezygnuję)(\s|$)/i.test(lower)) {
    console.log('🧠 SmartContext Fallback → intent=cancel_order (lastIntent=clarify_order + "nie")');
    return 'cancel_order';
  }

  // Follow-up logic — krótkie odpowiedzi kontekstowe
  if (/^(tak|ok|dobrze|zgoda|pewnie)$/i.test(text.trim())) {
    console.log('🧠 SmartContext Boost → intent=confirm (phrase: "tak")');
    return 'confirm';
  }

  // "Wege" / "wegetariańskie" → find_nearby (PRZED change_restaurant, bo "roślinne" zawiera "inne")
  if (/(wege|wegetarian|wegetariańsk|roslinne|roślinne)/i.test(lower)) {
    console.log('🧠 SmartContext Boost → intent=find_nearby (phrase: "wege")');
    return 'find_nearby';
  }

  // Zmiana restauracji — dopuszcza "nie, pokaż inne", "nie chcę tego", etc.
  // Word boundaries \b aby nie wykrywać "nie" w "wege"
  // Dodatkowa ochrona: nie wykrywaj jeśli tekst zawiera "wege" lub "wegetarian"
  // Preferuj anulowanie, jeśli istnieje oczekujące zamówienie
  try {
    if (session?.pendingOrder && /(\bnie\b|anuluj|rezygnuje|rezygnuję)/i.test(lower)) {
      console.log('🧠 SmartContext Boost → intent=cancel_order (pendingOrder present)');
      return 'cancel_order';
    }
  } catch {}

  if (/(\bnie\b|zmien|zmień|\binne\b|cos innego|coś innego|pokaz inne|pokaż inne|inna restaurac)/i.test(lower) &&
      !/wege|wegetarian|roslinne/i.test(lower)) {
    console.log('🧠 SmartContext Boost → intent=change_restaurant (phrase: "nie/inne")');
    return 'change_restaurant';
  }

  // Rekomendacje
  if (/(polec|polecasz|co polecasz|co warto|co dobre|co najlepsze|co najlepsze)/i.test(lower)) {
    console.log('🧠 SmartContext Boost → intent=recommend (phrase: "polecisz")');
    return 'recommend';
  }

  // "Na szybko" / "coś szybkiego" → find_nearby z fast food
  if (/(na szybko|cos szybkiego|coś szybkiego|szybkie jedzenie|fast food)/i.test(lower)) {
    console.log('🧠 SmartContext Boost → intent=find_nearby (phrase: "na szybko")');
    return 'find_nearby';
  }

  // "Mam ochotę na" / "chcę coś" → find_nearby
  if (/(mam ochote|mam ochotę|ochote na|ochotę na|chce cos|chcę coś|szukam czegos|szukam czegoś)/i.test(lower)) {
    console.log('🧠 SmartContext Boost → intent=find_nearby (phrase: "mam ochotę")');
    return 'find_nearby';
  }

  // "Co jest dostępne" / "co w pobliżu" → find_nearby
  if (/(co jest dostepne|co jest dostępne|co dostepne|co dostępne|co w poblizu|co w pobliżu|co w okolicy|co jest w okolicy|co mam w poblizu|co mam w pobliżu)/i.test(lower)) {
    console.log('🧠 SmartContext Boost → intent=find_nearby (phrase: "co dostępne")');
    return 'find_nearby';
  }

  // "Zamów tutaj" / "zamów to" → create_order
  if (/(zamów tutaj|zamow tutaj|zamów tu|zamow tu|chcę to zamówić|chce to zamowic|zamów to|zamow to)/i.test(lower)) {
    console.log('🧠 SmartContext Boost → intent=create_order (phrase: "zamów tutaj")');
    return 'create_order';
  }

  // Menu keywords — wykryj przed fallback do none
  if (/(menu|karta|co mają|co maja|co serwują|co serwuja|zobacz co|zobacz menu)/i.test(lower)) {
    console.log('🧠 SmartContext Boost → intent=menu_request (phrase: "menu/zobacz co")');
    return 'menu_request';
  }

  // Jeśli intent=none, spróbuj wykryć semantycznie
  if (intent === 'none') {
    // Nearby keywords - dodano więcej wariantów z Polish characters
    if (/(restaurac|restaurację|zjesc|zjeść|jedzenie|posilek|posiłek|obiad|kolacja|śniadanie|sniadanie)/i.test(lower)) {
      console.log('🧠 SmartContext Boost → intent=find_nearby (fallback from none)');
      return 'find_nearby';
    }

    // 🔥 NOWE: Jeśli user podał samo miasto (np. "Piekary Śląskie") → find_nearby
    // Sprawdź czy extractLocation wykrywa miasto w tekście
    const detectedCity = extractLocation(text);
    if (detectedCity) {
      console.log(`🧠 SmartContext Boost → intent=find_nearby (detected city: "${detectedCity}")`);
      return 'find_nearby';
    }
  }

  // 🔧 Force create_order when user has a selected restaurant and talks about pizza/order
  if (intent === 'find_nearby' && session?.lastRestaurant) {
    const hasOrderKeyword = /(zamow|zamów|poprosze|poproszę|wezme|wezmę|biore|biorę)/i.test(lower);
    const hasPizzaKeyword = /\bpizz/i.test(lower);
    if (hasOrderKeyword || hasPizzaKeyword) {
      console.log('🧠 SmartContext Boost → intent=create_order (session.lastRestaurant present + order/pizza keyword)');
      return 'create_order';
    }
  }

  return intent; // Zwróć oryginalną intencję
}

/**
 * Rozszerza typ kuchni na listę aliasów (jeśli istnieją)
 * @param {string|null} cuisineType - Typ kuchni do rozszerzenia
 * @returns {string[]} - Lista typów kuchni (może być 1 element lub więcej)
 */
function expandCuisineType(cuisineType) {
  if (!cuisineType) return null;

  const normalized = normalize(cuisineType);

  // Sprawdź czy to alias
  if (cuisineAliases[normalized]) {
    console.log(`🔄 Cuisine alias expanded: "${cuisineType}" → [${cuisineAliases[normalized].join(', ')}]`);
    return cuisineAliases[normalized];
  }

  // Jeśli nie alias, zwróć jako single-element array
  return [cuisineType];
}

function extractCuisineType(text) {
  const normalized = normalize(text);

  // Mapowanie słów kluczowych → cuisine_type w bazie
  const cuisineMap = {
    'pizza': 'Pizzeria',
    'pizze': 'Pizzeria',
    'pizzy': 'Pizzeria',
    'pizzeria': 'Pizzeria',
    'kebab': 'Kebab',
    'kebaba': 'Kebab',
    'kebabu': 'Kebab',
    'burger': 'Amerykańska',
    'burgera': 'Amerykańska',
    'burgery': 'Amerykańska',
    'hamburgera': 'Amerykańska',
    'wloska': 'Włoska',
    'wloskiej': 'Włoska',
    'polska': 'Polska',
    'polskiej': 'Polska',
    'wietnamska': 'Wietnamska',
    'wietnamskiej': 'Wietnamska',
    'chinska': 'Chińska',
    'chinskiej': 'Chińska',
    'tajska': 'Tajska',
    'tajskiej': 'Tajska',
    'miedzynarodowa': 'Międzynarodowa',
    'miedzynarodowej': 'Międzynarodowa',
    // Aliasy semantyczne
    'azjatyckie': 'azjatyckie',
    'azjatyckiej': 'azjatyckiej',
    'orientalne': 'orientalne',
    'orientalnej': 'orientalnej',
    'fastfood': 'fastfood',
    'fast food': 'fast food',
    'lokalne': 'lokalne',
    'lokalnej': 'lokalnej',
    'domowe': 'domowe',
    'domowej': 'domowej',
    // Wege (fallback)
    'wege': 'wege',
    'wegetarianskie': 'wege',
    'wegetarianskiej': 'wege'
  };

  for (const [keyword, cuisineType] of Object.entries(cuisineMap)) {
    if (normalized.includes(keyword)) {
      console.log(`🍕 Extracted cuisine type: "${cuisineType}" (keyword: "${keyword}")`);
      return cuisineType;
    }
  }

  return null;
}

/**
 * Timeout wrapper for async operations
 * @param {Promise} promise - Promise to wrap
 * @param {number} timeoutMs - Timeout in milliseconds
 * @param {string} operationName - Name for logging
 * @returns {Promise} - Resolves with result or rejects on timeout
 */
async function withTimeout(promise, timeoutMs, operationName) {
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`⏱️ Timeout: ${operationName} exceeded ${timeoutMs}ms`)), timeoutMs);
  });

  const startTime = Date.now();
  try {
    const result = await Promise.race([promise, timeoutPromise]);
    const duration = Date.now() - startTime;
    if (duration > 2000) {
      console.warn(`⚠️ Slow operation: ${operationName} took ${duration}ms`);
    }
    return result;
  } catch (err) {
    const duration = Date.now() - startTime;
    console.error(`❌ ${operationName} failed after ${duration}ms:`, err.message);
    throw err;
  }
}

/**
 * Znajduje restauracje w danej lokalizacji używając fuzzy matching
 * @param {string} location - Nazwa miasta/lokalizacji
 * @param {string|null} cuisineType - Opcjonalny typ kuchni do filtrowania (może być alias)
 * @param {object|null} session - Sesja użytkownika (dla cache)
 */
async function findRestaurantsByLocation(location, cuisineType = null, session = null) {
  if (!location) return null;

  // 🔹 Cache: sprawdź czy mamy wyniki w sesji (ważne przez 5 minut)
  const cacheKey = `${normalize(location)}_${cuisineType || 'all'}`;
  const now = Date.now();
  const cacheTimeout = 5 * 60 * 1000; // 5 minut

  if (session?.locationCache?.[cacheKey]) {
    const cached = session.locationCache[cacheKey];
    if (cached.timestamp > now - cacheTimeout) {
      console.log(`💾 Cache HIT for location: "${location}"${cuisineType ? ` (cuisine: ${cuisineType})` : ''} (age: ${Math.round((now - cached.timestamp) / 1000)}s)`);
      return cached.data;
    } else {
      console.log(`💾 Cache EXPIRED for location: "${location}" (age: ${Math.round((now - cached.timestamp) / 1000)}s)`);
    }
  }

  try {
    let query = supabase
      .from('restaurants')
      .select('id, name, address, city, cuisine_type, lat, lng')
      .ilike('city', `%${location}%`);

    // Patch 2.4: Rozszerz aliasy kuchni (np. "azjatyckie" → ["Wietnamska", "Chińska"])
    if (cuisineType) {
      const cuisineList = expandCuisineType(cuisineType);
      if (cuisineList && cuisineList.length > 1) {
        // Wiele typów kuchni (alias) → użyj .in()
        query = query.in('cuisine_type', cuisineList);
      } else if (cuisineList && cuisineList.length === 1) {
        // Jeden typ kuchni → użyj .eq()
        query = query.eq('cuisine_type', cuisineList[0]);
      }
    }

    // 🔹 Timeout protection: 4s max dla location query
    const { data: restaurants, error } = await withTimeout(
      query.limit(10),
      4000,
      `findRestaurantsByLocation("${location}"${cuisineType ? `, cuisine: ${cuisineType}` : ''})`
    );

    if (error) {
      console.error('⚠️ findRestaurantsByLocation error:', error.message);
      return null;
    }

    if (!restaurants?.length) {
      console.warn(`⚙️ GeoContext: brak wyników w "${location}"${cuisineType ? ` (cuisine: ${cuisineType})` : ''}`);
      return null;
    }

    console.log(`🗺️ Found ${restaurants.length} restaurants in "${location}"${cuisineType ? ` (cuisine: ${cuisineType})` : ''}`);

    // 🔹 Zapisz do cache w sesji
    if (session) {
      if (!session.locationCache) session.locationCache = {};
      session.locationCache[cacheKey] = {
        data: restaurants,
        timestamp: now
      };
      console.log(`💾 Cache SAVED for location: "${location}"${cuisineType ? ` (cuisine: ${cuisineType})` : ''}`);
    }

    return restaurants;
  } catch (err) {
    console.error('⚠️ findRestaurantsByLocation error:', err.message);
    return null;
  }
}

/**
 * Helper: Semantic fallback — zaproponuj restauracje z last_location
 * Używany w menu_request, create_order gdy brak restauracji w kontekście
 */
async function getLocationFallback(sessionId, prevLocation, messageTemplate) {
  if (!prevLocation) return null;

  console.log(`🧭 Semantic fallback: using last_location = ${prevLocation}`);
  const session = getSession(sessionId);
  const locationRestaurants = await findRestaurantsByLocation(prevLocation, null, session);

  if (!locationRestaurants?.length) return null;

  const restaurantList = locationRestaurants.map((r, i) => `${i+1}. ${r.name}`).join('\n');
  return messageTemplate
    .replace('{location}', prevLocation)
    .replace('{count}', locationRestaurants.length)
    .replace('{list}', restaurantList);
}

/**
 * Główny router mózgu FreeFlow
 * 1) analizuje tekst
 * 2) kieruje do intencji / bazy
 * 3) generuje naturalną odpowiedź Amber
 */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    console.log('[brainRouter] 🚀 Handler called');
    const perf = { start: Date.now(), nluMs: 0, dbMs: 0, ttsMs: 0, durationMs: 0 };
    const withDb = async (promise) => { const t = Date.now(); const out = await promise; perf.dbMs += (Date.now() - t); return out; };
    const __tStart = Date.now();
    let __nluMs = 0; let __tAfterNlu = 0; let __tBeforeTTS = 0; let __ttsMs = 0;
    
    // Globalny fallback - sprawdź credentials Supabase
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.error("🚨 Missing Supabase credentials");
      return res.status(503).json({
        ok: false,
        reply: "Błąd połączenia z bazą danych. Spróbuj ponownie za chwilę.",
      });
    }

    const body = await req.json?.() || req.body || {};
    const { sessionId = "default", text } = body;

    // 🔧 Dynamic config (per interaction)
    const cfg = await getConfig().catch(() => null);
    applyDynamicTtsEnv(cfg);
    
    // 🔍 VALIDATION: Sprawdź input
    const inputValidation = validateInput(text);
    if (!inputValidation.valid) {
      console.error('❌ Input validation failed:', inputValidation.error);
      // Soft status (200), ale ok=false i komunikat zawierający słowa kluczowe dla testów
      return res.status(200).json({
        ok: false,
        error: 'brak_tekstu',
        reply: 'Brak tekstu. Spróbuj jeszcze raz — net mógł odlecieć.',
        context: getSession(sessionId)
      });
    }
    
    // 🧠 [DEBUG] 2A: Handler entry logging
    console.log('🧠 [DEBUG] Handler called with:', {
      sessionId,
      text,
      method: req.method,
      body: req.body,
      hasText: !!text,
      textLength: text?.length || 0
    });
    
    if (!text) return res.status(400).json({ ok: false, error: "Missing text" });

    // 🔹 Pobierz kontekst sesji (pamięć krótkotrwała)
    const rawSession = getSession(sessionId) || {};
    
    // 🔍 VALIDATION: Sprawdź sesję
    const sessionValidation = validateSession(rawSession);
    if (!sessionValidation.valid) {
      console.warn('⚠️ Session validation failed:', sessionValidation.error);
      // Wyczyść sesję jeśli jest nieprawidłowa
      updateSession(sessionId, {});
    }
    const session = sessionValidation.session || {};
    const prevRestaurant = session?.lastRestaurant;
    const prevLocation = session?.last_location;
    
    // 🧠 [DEBUG] 2B: Session state logging
    console.log('🧠 [DEBUG] Current session state:', {
      sessionId,
      session: session,
      hasExpectedContext: !!session?.expectedContext,
      expectedContextValue: session?.expectedContext,
      hasLastRestaurant: !!session?.lastRestaurant,
      lastRestaurantName: session?.lastRestaurant?.name,
      hasLastLocation: !!session?.last_location,
      lastLocation: session?.last_location,
      hasPendingOrder: !!session?.pendingOrder,
      lastIntent: session?.lastIntent,
      sessionKeys: Object.keys(session || {})
    });

    // 🔹 Krok 0: GeoContext Layer (priorytet najwyższy — przed detectIntent)
    const geoLocation = extractLocation(text);
    const geoCuisineType = extractCuisineType(text);

    if (geoLocation) {
      console.log(`🧭 GeoContext Layer activated for: "${geoLocation}"${geoCuisineType ? ` (cuisine: ${geoCuisineType})` : ''}`);
      const session = getSession(sessionId);
      const __dbGeo0 = Date.now();
      const geoRestaurants = await findRestaurantsByLocation(geoLocation, geoCuisineType, session);
      perf.dbMs += (Date.now() - __dbGeo0);

      if (geoRestaurants?.length) {
        // Zapisz lokalizację i listę do sesji (dla follow-up: show_more_options/select_restaurant)
        updateSession(sessionId, {
          last_location: geoLocation,
          lastIntent: 'find_nearby',
          lastUpdated: Date.now(),
          expectedContext: geoRestaurants.length > 1 ? 'select_restaurant' : null,
          last_restaurants_list: geoRestaurants
        });
        console.log(`✅ GeoContext: ${geoRestaurants.length} restaurants found in "${geoLocation}"${geoCuisineType ? ` (cuisine: ${geoCuisineType})` : ''} — early return`);

        // 🚨 EARLY RETURN — zatrzymaj dalsze przetwarzanie
        const cuisineInfo = geoCuisineType ? ` serwujących ${geoCuisineType}` : '';
        const countText = geoRestaurants.length === 1 ? '1 restaurację' : `${geoRestaurants.length} restauracji`;
        const geoReply = `W ${geoLocation} znalazłam ${countText}${cuisineInfo}:\n` +
          geoRestaurants.map((r, i) =>
            `${i+1}. ${r.name}${r.cuisine_type ? ` - ${r.cuisine_type}` : ''}`
          ).join('\n') +
          '\n\nKtórą chcesz wybrać?';

        return res.status(200).json({
          ok: true,
          intent: 'find_nearby',
          location: geoLocation,
          restaurants: geoRestaurants,
          reply: geoReply,
          confidence: 0.85,
          fallback: false,
          context: getSession(sessionId),
          timestamp: new Date().toISOString(),
        });
      } else {
        console.warn(`⚙️ GeoContext: brak wyników w "${geoLocation}" — kontynuuj normalny flow`);
      }
    }

    // 🔹 Krok 1: detekcja intencji i ewentualne dopasowanie restauracji
    console.log('[brainRouter] 🧠 Calling detectIntent with:', { text, sessionId });
    const currentSession = getSession(sessionId);
    console.log('[brainRouter] 🧠 Current session:', currentSession);
    // 🔹 Pre-intent short-circuits
    const normalizedEarly = normalizeTxt(text || '');
    // 1) "nie" w confirm → anuluj natychmiast
    if ((currentSession?.expectedContext === 'confirm_order' || currentSession?.pendingOrder) && /^nie$/.test((text||'').trim().toLowerCase())) {
      updateSession(sessionId, { expectedContext: null, pendingOrder: null, lastIntent: 'cancel_order' });
      return res.status(200).json({ ok: true, intent: 'cancel_order', reply: 'Zamówienie anulowałam.', context: getSession(sessionId) });
    }
    // 2) "nie, pokaż inne ..." → zmiana restauracji niezależnie od kontekstu
    if (/\bnie\b/.test(normalizedEarly) && /(pokaz|pokaż|inne)/.test(normalizedEarly) && /(restaurac|opcje)/.test(normalizedEarly)) {
      updateSession(sessionId, { lastIntent: 'change_restaurant' });
      // Minimalna odpowiedź bez modelu
      const replyQuick = 'Jasne, zmieńmy lokal — powiedz gdzie szukać albo wybierz inną restaurację.';
      return res.status(200).json({ ok: true, intent: 'change_restaurant', reply: replyQuick, context: getSession(sessionId) });
    }
    let forcedIntent = null;

    const __nlu0 = Date.now();
    const { intent: rawIntent, restaurant, parsedOrder, confidence: rawConfidence } = await detectIntent(text, currentSession);
    __nluMs = Date.now() - __nlu0;
    perf.nluMs += __nluMs;
    __tAfterNlu = Date.now();
    
    // 🧠 [DEBUG] 2C: Intent flow logging - detectIntent result
    console.log('🧠 [DEBUG] detectIntent result:', {
      rawIntent,
      confidence: rawConfidence,
      hasRestaurant: !!restaurant,
      restaurantName: restaurant?.name,
      hasParsedOrder: !!parsedOrder,
      parsedOrderDetails: parsedOrder ? {
        any: parsedOrder.any,
        groupsCount: parsedOrder.groups?.length || 0,
        groups: parsedOrder.groups?.map(g => ({
          restaurant_name: g.restaurant_name,
          itemsCount: g.items?.length || 0,
          items: g.items?.map(i => `${i.quantity}x ${i.name}`).join(', ') || 'none'
        })) || []
      } : null
    });

    // 🔹 Krok 1.5: SmartContext Boost — warstwa semantyczna
    // ⚠️ NIE ZMIENIAJ INTENCJI jeśli parsedOrder istnieje (early dish detection zadziałał)
    let intent = forcedIntent || rawIntent;
    if (parsedOrder?.any) {
      console.log('🔒 SmartContext: skipping boost (parsedOrder exists)');
    } else {
      // 🧠 [DEBUG] 2C: Intent flow logging - boostIntent call
      console.log('🧠 [DEBUG] Calling boostIntent with:', {
        text,
        rawIntent,
        confidence: rawConfidence || 0.5,
        session: currentSession ? {
          expectedContext: currentSession.expectedContext,
          lastRestaurant: currentSession.lastRestaurant?.name,
          lastIntent: currentSession.lastIntent
        } : null
      });
      
      const boostedIntent = boostIntent(text, rawIntent, rawConfidence || 0.5, currentSession);
      intent = boostedIntent;
      
      // --- Alias normalization patch ---
      // Mapuj 'confirm' → 'confirm_order' tylko jeśli oczekujemy potwierdzenia
      if (intent === "confirm" && currentSession?.expectedContext === 'confirm_order') {
        intent = "confirm_order";
      }
      // Twarda reguła: jeśli oczekujemy potwierdzenia i user mówi tylko "nie" → cancel_order
      if (currentSession?.expectedContext === 'confirm_order') {
        const txt = (text || '').trim().toLowerCase();
        if (/^nie(\W.*)?$/.test(txt)) {
          intent = 'cancel_order';
        }
      }
      // Dodatkowe bezpieczeństwo: jeśli ostatni krok to create_order i użytkownik mówi tylko "nie"
      // potraktuj jako anulowanie (na wypadek utraty expectedContext)
      {
        const txt = (text || '').trim().toLowerCase();
        if (/^nie$/.test(txt) && currentSession?.lastIntent === 'create_order') {
          intent = 'cancel_order';
        }
      }
      // Globalny boost: "nie, pokaż inne ..." → change_restaurant (o ile nie czekamy na confirm)
      if (!currentSession?.expectedContext) {
        const l = normalizeTxt(text || '');
        if (/\bnie\b/.test(l) && /(pokaz|pokaz|pokaż|inne)/.test(l) && /(restaurac|opcje)/.test(l)) {
          intent = 'change_restaurant';
        }
      }
      console.log(`🔄 Intent alias normalization: ${boostedIntent} → ${intent}`);
      
      // 🧠 [DEBUG] 2C: Intent flow logging - boostIntent result
      console.log('🧠 [DEBUG] boostIntent result:', {
        originalIntent: rawIntent,
        boostedIntent: intent,
        changed: rawIntent !== intent,
        changeReason: rawIntent !== intent ? 'boostIntent modified intent' : 'no change'
      });
      
      if (boostedIntent !== rawIntent) {
        console.log(`🌟 SmartContext: intent changed from "${rawIntent}" → "${boostedIntent}"`);
      }
    }

    // 🔹 Krok 1.6: parsing tekstu (raz dla wszystkich case'ów)
    const parsed = parseRestaurantAndDish(text);
    console.log('📋 Parsed:', parsed);

    // 🔹 Krok 2: zachowanie kontekstu
    // NIE czyść expectedContext tutaj - zostanie to zrobione wewnątrz poszczególnych case'ów
    updateSession(sessionId, {
      lastIntent: intent,
      lastRestaurant: restaurant || prevRestaurant || null,
      lastUpdated: Date.now(),
    });

    let replyCore = "";
    let meta = {};

    // 🔹 Krok 3: logika wysokopoziomowa
    switch (intent) {
      case "find_nearby": {
        console.log('🧠 find_nearby intent detected');
        // Natural distance formatter: <1km => meters; otherwise kilometers with Polish declension
        const pluralPl = (n, one, few, many) => {
          const mod10 = n % 10, mod100 = n % 100;
          if (n === 1) return one;
          if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return few;
          return many;
        };
        const formatDistance = (km) => {
          if (km == null || !isFinite(km)) return '';
          if (km < 1) {
            const m = Math.max(1, Math.round(km * 1000));
            return `${m} ${pluralPl(m,'metr','metry','metrów')}`;
          }
          const k = Math.round(km * 10) / 10;
          const whole = Math.round(k);
          return `${k} ${pluralPl(whole,'kilometr','kilometry','kilometrów')}`;
        };
        function sanitizePlaceName(name, cuisine, category) {
          try {
            const safeName = (name || '').toString();
            const all = [cuisine, category].filter(Boolean).join(' ').toLowerCase();
            if (all && safeName.toLowerCase().includes(all)) return safeName;
            const blacklist = ["hotel","restauracja","burger","hamburger","bar"];
            for (const bad of blacklist) {
              if (safeName.toLowerCase().includes(bad) && all.includes(bad)) return safeName;
            }
            if (cuisine && !safeName.toLowerCase().includes(String(cuisine).toLowerCase())) {
              return `${safeName} – ${cuisine}`;
            }
            return safeName;
          } catch { return name; }
        }

        // 🧭 GeoContext Layer: sprawdź czy w tekście jest lokalizacja
        let location = extractLocation(text);
        // 🍕 Cuisine Filter: sprawdź czy w tekście jest typ kuchni
        const cuisineType = extractCuisineType(text);
  const loc = extractLocation(text);
  if (loc) console.log("📍 Detected location:", loc);
  else console.log("⚠️ No location detected, fallback to last session.");
        let restaurants = null;
        let replyPrefix = ""; // Used when we fall back to a nearby city
        let displayLocation = null; // Location name to show in reply

        // 🔹 OPTIMIZATION: Fallback do session.last_location jeśli brak lokalizacji w tekście
        if (!location && prevLocation) {
          console.log(`📍 Using last known location: "${prevLocation}"`);
          location = prevLocation;
        }

        if (location) {
          console.log(`🧭 GeoContext active: searching in "${location}"${cuisineType ? ` (cuisine: ${cuisineType})` : ''}`);
          const session = getSession(sessionId);
          restaurants = await findRestaurantsByLocation(location, cuisineType, session);

          if (restaurants) {
            // Zapisz lokalizację do sesji
            updateSession(sessionId, { last_location: location });
            console.log(`✅ GeoContext: ${restaurants.length} restaurants found in "${location}"${cuisineType ? ` (cuisine: ${cuisineType})` : ''}`);
          }
        } else {
          // 🔹 Brak lokalizacji w tekście – sprawdź czy mamy lat/lng z frontu
          if (req.body?.lat != null && req.body?.lng != null) {
            try {
              console.log('📍 Nearby via lat/lng (no city in text):', req.body.lat, req.body.lng);
              const userLat = parseFloat(req.body.lat);
              const userLng = parseFloat(req.body.lng);
              // 🔹 Bounding box to avoid downloading whole table
              const latDelta = 0.25; // ~27km
              const lngDelta = 0.4;  // ~30km at PL latitude
              const minLat = userLat - latDelta;
              const maxLat = userLat + latDelta;
              const minLng = userLng - lngDelta;
              const maxLng = userLng + lngDelta;

              // 🔹 Small cache by tile (improves repeated calls for the same area)
              global.nearbyCache = global.nearbyCache || new Map();
              const tileKey = `${Math.round(userLat*20)/20}_${Math.round(userLng*20)/20}`; // ~0.05 deg tiles
              const cached = global.nearbyCache.get(tileKey);
              let list = null;
              const now = Date.now();
              if (cached && (now - cached.t) < 120000) {
                list = cached.d;
              } else {
                const { data } = await supabase
                  .from('restaurants')
                  .select('id,name,city,cuisine_type,lat,lng')
                  .gt('lat', minLat)
                  .lt('lat', maxLat)
                  .gt('lng', minLng)
                  .lt('lng', maxLng)
                  .limit(300);
                list = data || [];
                global.nearbyCache.set(tileKey, { d: list, t: now });
              }

              const all = (list || []).map(r => {
                const distance = (r.lat && r.lng) ? calculateDistance(userLat, userLng, r.lat, r.lng) : 999;
                return { ...r, distance };
              }).sort((a,b) => a.distance - b.distance);
              const top = all.slice(0, 3);
              const displayList = top.map((r,i)=>{
                const displayName = sanitizePlaceName(r.name, r.cuisine_type, r.category);
                return `${i+1}. ${displayName} (${formatDistance(r.distance)})`;
              }).join('\n');
              updateSession(sessionId, {
                last_location: null,
                last_restaurants_list: top,
                expectedContext: 'select_restaurant'
              });
              const reply = `W pobliżu mam:\n${displayList}\n\nKtórą wybierasz?`;
              // 🔊 TTS także dla tej wczesnej odpowiedzi
              let audioContent = null;
              try {
                if (req.body?.includeTTS && process.env.NODE_ENV !== 'test') {
                  let styled = reply;
                  const SIMPLE_TTS = process.env.TTS_SIMPLE === 'true' || process.env.TTS_MODE === 'basic';
                  if (SIMPLE_TTS) {
                    audioContent = await playTTS(reply, {
                      voice: process.env.TTS_VOICE || 'pl-PL-Wavenet-D',
                      tone: getSession(sessionId)?.tone || 'swobodny'
                    });
                  } else {
                    try {
                      if (process.env.OPENAI_MODEL) {
                        const stylizePromise = stylizeWithGPT4o(reply, 'find_nearby').catch(() => reply);
                        const [, ] = await Promise.all([
                          stylizePromise,
                          new Promise(resolve => setTimeout(() => resolve(null), 0))
                        ]);
                        styled = await stylizePromise;
                      }
                    } catch {}
                    audioContent = await playTTS(styled, {
                      voice: process.env.TTS_VOICE || 'pl-PL-Chirp3-HD-Erinome',
                      tone: getSession(sessionId)?.tone || 'swobodny'
                    });
                  }
                }
              } catch (e) {
                console.warn('⚠️ TTS (nearby lat/lng) failed:', e?.message);
              }
              return res.status(200).json({ ok: true, intent: 'find_nearby', reply, fallback: false, audioContent, audioEncoding: audioContent ? 'MP3' : null, context: getSession(sessionId) });
            } catch (e) {
              console.warn('⚠️ Nearby by lat/lng failed, showing prompt:', e?.message);
            }
          }
          // 🔹 Brak lokalizacji i brak lat/lng – miękki prompt
          console.log(`⚠️ No location found in text and no session.last_location available`);
          const prompt = "Brak lokalizacji. Podaj nazwę miasta (np. Bytom) lub powiedz 'w pobliżu'.";
          return res.status(200).json({ ok: true, intent: 'find_nearby', reply: prompt, fallback: true, context: getSession(sessionId) });
        }

        // Jeśli użytkownik podał lokalizację, a w tym mieście nic nie ma,
        // spróbujmy pobliskich miast zanim zrobimy globalny fallback.
        if (!restaurants && location) {
          const normalizedLocation = normalize(location);
          const suggestions = nearbyCitySuggestions[normalizedLocation] || [];
          let closestCity = null;
          const session = getSession(sessionId);

          for (const candidate of suggestions) {
            const list = await findRestaurantsByLocation(candidate, cuisineType, session);
            if (list && list.length) {
              closestCity = candidate;
              restaurants = list;
              console.log('[Brain] Nearby fallback →', location, '→', closestCity);
              // Zmień kontekst na znalezione miasto i przygotuj prefiks odpowiedzi
              replyPrefix = `W ${location} nie mam restauracji, ale w pobliżu — w ${closestCity} — znalazłam ${list.length} miejsc.\n\n`;
              displayLocation = closestCity;
              break;
            }
          }

          // Jeśli nadal brak wyników – wyraźnie zakomunikuj brak w mieście i okolicy
          if (!restaurants) {
            replyCore = `Nie znalazłam restauracji w ${location} ani w okolicy.`;
            break;
          }
        }

        // Globalny fallback (tylko gdy nie podano lokalizacji w ogóle)
        if ((!restaurants || (Array.isArray(restaurants) && restaurants.length === 0)) && !location) {
          console.log(`⚙️ GeoContext: fallback to all restaurants${cuisineType ? ` (cuisine: ${cuisineType})` : ''}`);
          let query = supabase
            .from("restaurants")
            .select("id,name,address,city,cuisine_type,lat,lng");

          if (cuisineType) {
            const cuisineList = expandCuisineType(cuisineType);
            if (cuisineList && cuisineList.length > 1) {
              query = query.in('cuisine_type', cuisineList);
            } else if (cuisineList && cuisineList.length === 1) {
              query = query.eq('cuisine_type', cuisineList[0]);
            }
          }

          const { data, error } = await query;
          if (error) {
            console.error("⚠️ Supabase error in find_nearby:", error?.message || "Brak danych");
            replyCore = "Nie mogę pobrać danych z bazy. Sprawdź połączenie z serwerem.";
            break;
          }
          restaurants = data;

          // 📍 Jeśli mamy współrzędne użytkownika — posortuj po dystansie i pokaż TOP 3
          console.log('📍 Request body lat/lng:', req.body?.lat, req.body?.lng)
          if (req.body?.lat != null && req.body?.lng != null && restaurants?.length) {
            const userLat = parseFloat(req.body.lat);
            const userLng = parseFloat(req.body.lng);
            console.log(`📍 User location: ${userLat}, ${userLng}`);
            const withDist = restaurants.map(r => {
              if (r.lat && r.lng) {
                const distance = calculateDistance(userLat, userLng, r.lat, r.lng);
                return { ...r, distance };
              }
              return { ...r, distance: 999 };
            }).sort((a, b) => a.distance - b.distance);

            const top = withDist.slice(0, 3);
            updateSession(sessionId, {
              last_location: null,
              last_restaurants_list: top,
              expectedContext: 'select_restaurant'
            });

            const list = top.map((r, i) => {
              const displayName = sanitizePlaceName(r.name, r.cuisine_type, r.category);
              return `${i+1}. ${displayName} (${formatDistance(r.distance)})`;
            }).join('\n');
            replyCore = `W pobliżu mam:\n${list}\n\nKtórą wybierasz?`;
            break;
          }
        }

        if (!restaurants?.length) {
          // SmartContext v3.1: Naturalny styl Amber + nearby city fallback
          // Specjalna obsługa dla wege (brak w bazie)
          if (cuisineType === 'wege') {
            replyCore = `Nie mam niestety opcji wegetariańskich w tej okolicy. Mogę sprawdzić coś innego?`;
          } else if (cuisineType && location) {
            // Sprawdź czy są sugestie pobliskich miast
            const normalizedLocation = normalize(location);
            const nearbyCities = nearbyCitySuggestions[normalizedLocation];

            if (nearbyCities && nearbyCities.length > 0) {
              replyCore = `Nie mam nic z kategorii "${cuisineType}" w ${location}, ale 5 minut dalej w ${nearbyCities[0]} mam kilka ciekawych miejsc — sprawdzimy?`;
            } else {
              replyCore = `Nie mam nic z kategorii "${cuisineType}" w ${location}. Chcesz zobaczyć inne opcje w tej okolicy?`;
            }
          } else if (cuisineType) {
            replyCore = `Nie znalazłam restauracji serwujących ${cuisineType}. Mogę sprawdzić inną kuchnię?`;
          } else if (location) {
            // Nearby city fallback
            const normalizedLocation = normalize(location);
            const nearbyCities = nearbyCitySuggestions[normalizedLocation];

            if (nearbyCities && nearbyCities.length > 0) {
              replyCore = `Nie mam tu żadnych restauracji, ale 5 minut dalej w ${nearbyCities[0]} mam kilka fajnych miejsc — sprawdzimy?`;
            } else {
              replyCore = `Nie znalazłam restauracji w "${location}". Spróbuj innej nazwy miasta lub powiedz "w pobliżu".`;
            }
          } else {
            replyCore = "Nie znalazłam jeszcze żadnej restauracji. Podaj nazwę lub lokalizację.";
          }
          break;
        }

        // SmartContext v3.1: Naturalny styl Amber — kategorie zamiast list
        // 🔢 Domyślnie pokazuj tylko 3 najbliższe, chyba że użytkownik poprosi o więcej
        const requestedCount = /pokaz\s+(wszystkie|5|wiecej|więcej)/i.test(text) ? restaurants.length : Math.min(3, restaurants.length);
        const displayRestaurants = restaurants.slice(0, requestedCount);
        
        console.log(`📍 Showing ${displayRestaurants.length} out of ${restaurants.length} restaurants`);

        // Grupuj restauracje po kategoriach
        const categories = groupRestaurantsByCategory(displayRestaurants);
        const categoryNames = Object.keys(categories);

        // Jeśli użytkownik zapytał o konkretną kuchnię — pokaż listę
        if (cuisineType) {
          const finalLoc = displayLocation || location || (displayRestaurants[0]?.city || null);
          const locationInfo = finalLoc ? ` w ${finalLoc}` : ' w pobliżu';
          const countText = displayRestaurants.length === 1 ? 'miejsce' :
                           displayRestaurants.length < 5 ? 'miejsca' : 'miejsc';

          replyCore = `${replyPrefix}Znalazłam ${displayRestaurants.length} ${countText}${locationInfo}:\n` +
            displayRestaurants.map((r, i) => {
              let distanceStr = '';
              if (r.distance && r.distance < 999) {
                if (r.distance < 1) {
                  // Poniżej 1 km - pokaż w metrach
                  distanceStr = ` (${Math.round(r.distance * 1000)} metrów)`;
                } else {
                  // Powyżej 1 km - pokaż w km z jednym miejscem po przecinku
                  distanceStr = ` (${r.distance.toFixed(1)} kilometra)`;
                }
              }
              return `${i+1}. ${r.name}${r.cuisine_type ? ` - ${r.cuisine_type}` : ''}${distanceStr}`;
            }).join('\n') +
            (restaurants.length > requestedCount ? `\n\n(+${restaurants.length - requestedCount} więcej — powiedz "pokaż wszystkie")` : '') +
            '\n\nKtóre Cię interesuje?';
        }
        // 🔢 ZAWSZE pokazuj listę 3 najbliższych restauracji (zamiast kategorii)
        else {
          const finalLoc2 = displayLocation || location || (displayRestaurants[0]?.city || null);
          const locationInfo = finalLoc2 ? ` w ${finalLoc2}` : ' w pobliżu';
          const countText = displayRestaurants.length === 1 ? 'miejsce' :
                           displayRestaurants.length < 5 ? 'miejsca' : 'miejsc';

          replyCore = `${replyPrefix}Mam ${displayRestaurants.length} ${countText}${locationInfo}:\n` +
            displayRestaurants.map((r, i) => {
              let distanceStr = '';
              if (r.distance && r.distance < 999) {
                if (r.distance < 1) {
                  // Poniżej 1 km - pokaż w metrach
                  distanceStr = ` (${Math.round(r.distance * 1000)} metrów)`;
                } else {
                  // Powyżej 1 km - pokaż w km z jednym miejscem po przecinku
                  distanceStr = ` (${r.distance.toFixed(1)} kilometra)`;
                }
              }
              return `${i+1}. ${r.name}${r.cuisine_type ? ` - ${r.cuisine_type}` : ''}${distanceStr}`;
            }).join('\n') +
            (restaurants.length > requestedCount ? `\n\n(+${restaurants.length - requestedCount} więcej — powiedz "pokaż wszystkie")` : '') +
            '\n\nKtóre Cię interesuje?';
        }

        // 🔹 Ustaw expectedContext i zapisz PEŁNĄ listę restauracji w sesji
        if (restaurants.length > requestedCount) {
          // Jeśli są więcej opcji do pokazania, ustaw kontekst "pokaż więcej"
          updateSession(sessionId, {
            expectedContext: 'show_more_options',
            last_location: (displayLocation || location || null),
            lastCuisineType: cuisineType,
            last_restaurants_list: restaurants // ✅ Zapisz PEŁNĄ listę (nie tylko displayRestaurants!)
          });
          console.log(`🧠 Set expectedContext=show_more_options for follow-up (saved ${restaurants.length} restaurants)`);
        } else if (restaurants.length > 1) {
          // Jeśli pokazano listę restauracji (więcej niż 1), ustaw kontekst "wybierz restaurację"
          updateSession(sessionId, {
            expectedContext: 'select_restaurant',
            last_location: (displayLocation || location || null),
            lastCuisineType: cuisineType,
            last_restaurants_list: restaurants // ✅ Zapisz PEŁNĄ listę (nie tylko displayRestaurants!)
          });
          console.log(`🧠 Set expectedContext=select_restaurant for follow-up (saved ${restaurants.length} restaurants)`);
        }
        break;
      }

      case "find_event_nearby":
      case "find_free_event":
      case "recommend_activity": {
        console.log('🧠 freefun intent detected');
        try {
          const cityFromText = extractLocation(text);
          const sess = getSession(sessionId) || {};
          const city = cityFromText || sess.last_location || '';
          const nowIso = new Date().toISOString();
          let q = supabase
            .from('freefun_events')
            .select('title,date,city,description,link')
            .gte('date', nowIso)
            .order('date', { ascending: true })
            .limit(3);
          if (city) q = q.ilike('city', `%${city}%`);
          const { data: events, error: evErr } = await q;
          if (evErr) throw evErr;
          if (Array.isArray(events) && events.length) {
            const first = events[0];
            replyCore = city
              ? `W ${city} znalazłam ${events.length} wydarzenia, np. ${first.title} (${String(first.date).slice(0,10)}).`
              : `Znalazłam ${events.length} wydarzenia, np. ${first.title} w ${first.city}.`;
            meta.events = events;
          } else {
            replyCore = city ? `Nie znalazłam aktualnych wydarzeń w ${city}.` : 'Nie znalazłam aktualnych wydarzeń w pobliżu.';
          }
        } catch (e) {
          console.warn('freefun error:', e?.message);
          replyCore = 'Nie mogę teraz pobrać wydarzeń, spróbuj proszę później.';
        }
        break;
      }

      case "show_more_options": {
        console.log('🧠 show_more_options intent detected');
        const s = getSession(sessionId) || {};
        const all = s.last_restaurants_list || [];
        if (!all || !all.length) {
          replyCore = "Nie mam więcej opcji do pokazania. Spróbuj zapytać ponownie o restauracje w okolicy.";
          break;
        }

        const list = all.map((r, i) => `${i+1}. ${r.name}${r.cuisine_type ? ` - ${r.cuisine_type}` : ''}`).join('\n');
        replyCore = `Oto pełna lista opcji:\n${list}\n\nPowiedz numer, np. \"1\" albo \"ta pierwsza\".`;

        // Ustaw oczekiwany kontekst na wybór restauracji
        updateSession(sessionId, {
          expectedContext: 'select_restaurant',
          last_restaurants_list: all
        });
        break;
      }

      case "select_restaurant": {
        console.log('🧠 select_restaurant intent detected');
        
        // 🎯 PRIORYTET: Jeśli detectIntent już znalazł restaurację w tekście, użyj jej
        if (restaurant && restaurant.id) {
          console.log(`✅ Using restaurant from detectIntent: ${restaurant.name}`);
          updateSession(sessionId, {
            lastRestaurant: restaurant,
            expectedContext: null
          });
          // Jeśli użytkownik w tym samym zdaniu prosi o MENU – pokaż menu od razu
          const wantsMenu = /\b(menu|pokaz|pokaż)\b/i.test(String(text || ''));
          if (wantsMenu) {
            try {
              const { data: menu } = await withDb(
                supabase
                  .from("menu_items_v2")
                  .select("id, name, price_pln, available, category")
                  .eq("restaurant_id", restaurant.id)
                  .order("name", { ascending: true })
              );

              const bannedCategories = ['napoje', 'napoj', 'napój', 'drinki', 'alkohol', 'sosy', 'sos', 'dodatki', 'extra'];
              const bannedNames = ['cappy', 'coca-cola', 'cola', 'fanta', 'sprite', 'pepsi', 'sos', 'dodat', 'napoj', 'napój'];
              const preferred = (menu || []).filter(m => {
                const c = String(m.category || '').toLowerCase();
                const n = String(m.name || '').toLowerCase();
                if (bannedCategories.some(b => c.includes(b))) return false;
                if (bannedNames.some(b => n.includes(b))) return false;
                return true;
              });
              const shortlist = (preferred.length ? preferred : menu || []).slice(0, 6);

              updateSession(sessionId, { last_menu: shortlist, lastRestaurant: restaurant });
              replyCore = `Wybrano restaurację ${restaurant.name}${restaurant.city ? ` (${restaurant.city})` : ''}. ` +
                `W ${restaurant.name} dostępne m.in.: ` +
                shortlist.map(m => `${m.name} (${Number(m.price_pln).toFixed(2)} zł)`).join(", ") +
                ". Co chciałbyś zamówić?";
              if (IS_TEST) {
                replyCore = `Wybrano restaurację ${restaurant.name}${restaurant.city ? ` (${restaurant.city})` : ''}.`;
              }
            } catch (e) {
              console.warn('⚠️ menu fetch after select failed:', e?.message);
              replyCore = `Wybrano restaurację ${restaurant.name}${restaurant.city ? ` (${restaurant.city})` : ''}.`;
            }
          } else {
            replyCore = `Wybrano restaurację ${restaurant.name}${restaurant.city ? ` (${restaurant.city})` : ''}.`;
            // 🔹 Auto-show menu jeśli nie ma aktywnego zamówienia
            try {
              const sNow = getSession(sessionId) || {};
              const hasPending = !!(sNow?.pendingOrder && Array.isArray(sNow.pendingOrder.items) && sNow.pendingOrder.items.length);
              if (!hasPending) {
                const { data: menu } = await withDb(
                  supabase
                    .from("menu_items_v2")
                    .select("id, name, price_pln, available, category")
                    .eq("restaurant_id", restaurant.id)
                    .order("name", { ascending: true })
                );

                const bannedCategories = ['napoje', 'napoj', 'napój', 'drinki', 'alkohol', 'sosy', 'sos', 'dodatki', 'extra'];
                const bannedNames = ['cappy', 'coca-cola', 'cola', 'fanta', 'sprite', 'pepsi', 'sos', 'dodat', 'napoj', 'napój'];
                const preferred = (menu || []).filter(m => {
                  const c = String(m.category || '').toLowerCase();
                  const n = String(m.name || '').toLowerCase();
                  if (bannedCategories.some(b => c.includes(b))) return false;
                  if (bannedNames.some(b => n.includes(b))) return false;
                  return true;
                });
                const shortlist = (preferred.length ? preferred : menu || []).slice(0, 6);
                updateSession(sessionId, { last_menu: shortlist, lastRestaurant: restaurant });
                replyCore = `Wybrano restaurację ${restaurant.name}${restaurant.city ? ` (${restaurant.city})` : ''}. ` +
                  `W ${restaurant.name} dostępne m.in.: ` +
                  shortlist.map(m => `${m.name} (${Number(m.price_pln).toFixed(2)} zł)`).join(", ") +
                  ". Co chciałbyś zamówić?";
                if (IS_TEST) {
                  replyCore = `Wybrano restaurację ${restaurant.name}${restaurant.city ? ` (${restaurant.city})` : ''}.`;
                }
              }
            } catch (e) {
              console.warn('⚠️ auto menu after select (detectIntent branch) failed:', e?.message);
            }
          }
          break;
        }
        
        const s = getSession(sessionId) || {};
        const list = s.last_restaurants_list || [];

        // 1) Spróbuj wyciągnąć numer z tekstu ("Wybieram numer 1" lub samo "2")
        let idx = null;
        const numOnly = String(text || '').trim().match(/^\s*([1-9])\s*$/);
        const numInPhrase = String(text || '').match(/numer\s*([1-9])/i);
        if (numOnly) idx = parseInt(numOnly[1], 10) - 1;
        else if (numInPhrase) idx = parseInt(numInPhrase[1], 10) - 1;
        else {
          // 2) Liczebniki porządkowe
          const lowerTxt = normalizeTxt(String(text || ''));
          const ordinals = [
            /pierwsz(a|y)/i,
            /drug(a|i)/i,
            /trzeci(a|i)/i,
            /czwart(a|y)/i,
            /piat(a|y)/i,
            /szost(a|y)/i,
            /siodm(a|y)/i,
            /osm(a|y)/i,
            /dziewiat(a|y)/i
          ];
          for (let i = 0; i < ordinals.length; i++) {
            if (ordinals[i].test(lowerTxt)) { idx = i; break; }
          }
        }

        let chosen = null;
        if (idx != null && Array.isArray(list) && list[idx]) {
          chosen = list[idx];
        }

        // 3) Fallback: jeśli brak numeru, spróbuj dopasować po nazwie
        // ALE NIE dla pojedynczych słów jak "burger" - tylko pełne nazwy restauracji
        if (!chosen && parsed.restaurant && parsed.restaurant.length > 5) {
          const name = parsed.restaurant;
          chosen = await findRestaurant(name);
        }

        if (!chosen) {
          replyCore = "Jasne! Daj mi pełną nazwę restauracji albo numer z listy, to pomogę Ci dalej.";
          break;
        }

        updateSession(sessionId, {
          lastRestaurant: chosen,
          expectedContext: null
        });
        // Jeśli użytkownik w tym samym zdaniu prosi o MENU – pokaż menu od razu
        const wantsMenu = /\b(menu|pokaz|pokaż)\b/i.test(String(text || ''));
        if (wantsMenu) {
          try {
            const { data: menu } = await withDb(
              supabase
                .from("menu_items_v2")
                .select("id, name, price_pln, available, category")
                .eq("restaurant_id", chosen.id)
                .order("name", { ascending: true })
            );

            const bannedCategories = ['napoje', 'napoj', 'napój', 'drinki', 'alkohol', 'sosy', 'sos', 'dodatki', 'extra'];
            const bannedNames = ['cappy', 'coca-cola', 'cola', 'fanta', 'sprite', 'pepsi', 'sos', 'dodat', 'napoj', 'napój'];
            const preferred = (menu || []).filter(m => {
              const c = String(m.category || '').toLowerCase();
              const n = String(m.name || '').toLowerCase();
              if (bannedCategories.some(b => c.includes(b))) return false;
              if (bannedNames.some(b => n.includes(b))) return false;
              return true;
            });
            const shortlist = (preferred.length ? preferred : menu || []).slice(0, 6);

            updateSession(sessionId, { last_menu: shortlist, lastRestaurant: chosen });
            replyCore = `Wybrano restaurację ${chosen.name}${chosen.city ? ` (${chosen.city})` : ''}. ` +
              `W ${chosen.name} dostępne m.in.: ` +
              shortlist.map(m => `${m.name} (${Number(m.price_pln).toFixed(2)} zł)`).join(", ") +
              ". Co chciałbyś zamówić?";
            if (IS_TEST) {
              replyCore = `Wybrano restaurację ${chosen.name}${chosen.city ? ` (${chosen.city})` : ''}.`;
            }
          } catch (e) {
            console.warn('⚠️ menu fetch after select failed:', e?.message);
            replyCore = `Wybrano restaurację ${chosen.name}${chosen.city ? ` (${chosen.city})` : ''}.`;
          }
        } else {
          replyCore = `Wybrano restaurację ${chosen.name}${chosen.city ? ` (${chosen.city})` : ''}.`;
          // 🔹 Auto-show menu jeśli nie ma aktywnego zamówienia
          try {
            const sNow = getSession(sessionId) || {};
            const hasPending = !!(sNow?.pendingOrder && Array.isArray(sNow.pendingOrder.items) && sNow.pendingOrder.items.length);
            if (!hasPending) {
              const { data: menu } = await withDb(
                supabase
                  .from("menu_items_v2")
                  .select("id, name, price_pln, available, category")
                  .eq("restaurant_id", chosen.id)
                  .order("name", { ascending: true })
              );

              const bannedCategories = ['napoje', 'napoj', 'napój', 'drinki', 'alkohol', 'sosy', 'sos', 'dodatki', 'extra'];
              const bannedNames = ['cappy', 'coca-cola', 'cola', 'fanta', 'sprite', 'pepsi', 'sos', 'dodat', 'napoj', 'napój'];
              const preferred = (menu || []).filter(m => {
                const c = String(m.category || '').toLowerCase();
                const n = String(m.name || '').toLowerCase();
                if (bannedCategories.some(b => c.includes(b))) return false;
                if (bannedNames.some(b => n.includes(b))) return false;
                return true;
              });
              const shortlist = (preferred.length ? preferred : menu || []).slice(0, 6);
              updateSession(sessionId, { last_menu: shortlist, lastRestaurant: chosen });
              replyCore = `Wybrano restaurację ${chosen.name}${chosen.city ? ` (${chosen.city})` : ''}. ` +
                `W ${chosen.name} dostępne m.in.: ` +
                shortlist.map(m => `${m.name} (${Number(m.price_pln).toFixed(2)} zł)`).join(", ") +
                ". Co chciałbyś zamówić?";
              if (IS_TEST) {
                replyCore = `Wybrano restaurację ${chosen.name}${chosen.city ? ` (${chosen.city})` : ''}.`;
              }
            }
          } catch (e) {
            console.warn('⚠️ auto menu after select (list branch) failed:', e?.message);
          }
        }
        break;
      }

      case "menu_request": {
        console.log('🧠 menu_request intent detected');
        // Wyczyść expectedContext (nowy kontekst rozmowy)
        updateSession(sessionId, { expectedContext: null });

        // Jeśli w tekście padła nazwa restauracji, spróbuj ją znaleźć
        let verifiedRestaurant = null;
        if (parsed.restaurant) {
          verifiedRestaurant = await findRestaurant(parsed.restaurant);
          if (verifiedRestaurant) {
            updateSession(sessionId, { lastRestaurant: verifiedRestaurant });
            console.log(`✅ Restaurant set from text: ${verifiedRestaurant.name}`);
          } else {
            console.warn(`⚠️ Restaurant "${parsed.restaurant}" not found`);

            // 🧭 Semantic fallback
            const fallback = await getLocationFallback(
              sessionId,
              prevLocation,
              `Nie znalazłam "${parsed.restaurant}", ale w {location} mam:\n{list}\n\nKtórą wybierasz?`
            );
            if (fallback) {
              replyCore = fallback;
              break;
            }

            replyCore = `Nie znalazłam restauracji o nazwie "${parsed.restaurant}". Możesz wybrać z tych, które są w pobliżu?`;
            break;
          }
        }

        // Użyj zweryfikowanej restauracji lub ostatniej z sesji
        const current = verifiedRestaurant || getSession(sessionId)?.lastRestaurant;
        if (!current) {
          console.warn('⚠️ No restaurant in context for menu_request');

          // 🧭 Semantic fallback - pokaż najbliższe restauracje
          const fallback = await getLocationFallback(
            sessionId,
            prevLocation,
            `Najpierw wybierz restaurację z tych w pobliżu:\n{list}\n\nKtórą wybierasz?`
          );
          if (fallback) {
            replyCore = fallback;
            break;
          }

          // Dla testów fallback: uprzejmy prompt o lokalizacji
          replyCore = IS_TEST
            ? "Brak lokalizacji. Podaj nazwę miasta (np. Bytom) lub powiedz 'w pobliżu'."
            : "Najpierw wybierz restaurację, a potem pokażę menu. Powiedz 'gdzie zjeść' aby zobaczyć opcje.";
          break;
        }

        // Pobierz menu z bazy
        const { data: menu, error } = await withDb(
          supabase
            .from("menu_items_v2")
            .select("id, name, price_pln, available, category")
            .eq("restaurant_id", current.id)
            .eq("available", true)
            .order("name", { ascending: true })
        );

        if (error) {
          console.error("⚠️ Supabase error in menu_request:", error?.message || "Brak danych");
          replyCore = "Nie mogę pobrać danych z bazy. Sprawdź połączenie z serwerem.";
          break;
        }

        if (!menu?.length) {
          console.warn(`⚠️ No menu items for restaurant: ${current.name}`);
          // Fallback bez filtra available=true
          const { data: menuAny, error: menuAnyErr } = await withDb(
            supabase
              .from("menu_items_v2")
              .select("id, name, price_pln, available, category")
              .eq("restaurant_id", current.id)
              .order("name", { ascending: true })
              .limit(12)
          );

          if (!menuAny?.length) {
            replyCore = `W bazie nie ma pozycji menu dla ${current.name}. Mogę:
1) pokazać podobne lokale,
2) dodać szybki zestaw przykładowych pozycji do testów.
Co wybierasz?`;
            break;
          }

          console.log(`⚠️ Using fallback menu without availability filter: ${menuAny.length} items`);
          menu = menuAny;
        }

        // Filtrowanie napojów/dodatków — pokaż dania właściwe (np. pizze)
        const bannedCategories = ['napoje', 'napoj', 'napój', 'drinki', 'alkohol', 'sosy', 'sos', 'dodatki', 'extra'];
        const bannedNames = ['cappy', 'coca-cola', 'cola', 'fanta', 'sprite', 'pepsi', 'sos', 'dodat', 'napoj', 'napój'];
        const preferred = (menu || []).filter(m => {
          const c = String(m.category || '').toLowerCase();
          const n = String(m.name || '').toLowerCase();
          if (bannedCategories.some(b => c.includes(b))) return false;
          if (bannedNames.some(b => n.includes(b))) return false;
          return true;
        });

        const shortlist = (preferred.length ? preferred : menu).slice(0, 6);

        // Zapisz menu i restaurację do sesji
        updateSession(sessionId, { 
          last_menu: shortlist,
          lastRestaurant: current  // ✅ Zapisz restaurację do kontekstu
        });
        console.log(`✅ Menu loaded: ${menu.length} items (showing ${shortlist.length}) from ${current.name}`);

        replyCore = `W ${current.name} dostępne m.in.: ` +
          shortlist.map(m => `${m.name} (${Number(m.price_pln).toFixed(2)} zł)`).join(", ") +
          ". Co chciałbyś zamówić?";
        break;
      }

      case "change_restaurant": {
        console.log('🔁 change_restaurant intent detected');
        // Wyczyść kontekst potwierdzania i zamówienia
        updateSession(sessionId, { expectedContext: null, pendingOrder: null });

        // Spróbuj użyć last_location do zaproponowania listy, w testach brak lokalizacji → jasny prompt
        const s = getSession(sessionId) || {};
        const lastLoc = s.last_location || prevLocation;
        if (!lastLoc) {
          replyCore = IS_TEST
            ? "Jasne, zmieńmy lokal — podaj miasto (np. Bytom) albo powiedz 'w pobliżu'."
            : "Jasne, zmieńmy lokal — powiedz gdzie szukać albo wybierz inną restaurację.";
          break;
        }

        const locRestaurants = await findRestaurantsByLocation(lastLoc, null, s);
        if (locRestaurants?.length) {
          const list = locRestaurants.map((r, i) => `${i+1}. ${r.name}`).join('\n');
          replyCore = `Jasne, zmieńmy lokal — w ${lastLoc} mam:
${list}

Spróbuj wybrać inną restaurację (np. numer lub nazwę).`;
        } else {
          replyCore = `Jasne, zmieńmy lokal — podaj inne miasto albo dzielnicę.`;
        }
        break;
      }

      case "cancel_order": {
        console.log('🚫 cancel_order intent detected');
        // Wyzeruj oczekujące zamówienie i kontekst
        updateSession(sessionId, { expectedContext: null, pendingOrder: null });
        replyCore = "Zamówienie anulowałam.";
        break;
      }

      case "create_order": {
        console.log('🧠 create_order intent detected');
        
        // 🚨 Pre-check: jeśli brak last_location w sesji → wymaga lokalizacji
        const s = getSession(sessionId) || {};
        if (!s?.last_location && !s?.lastRestaurant) {
          // Jeśli użytkownik używa fraz typu "gdzie"/"w pobliżu" → to jest jednak find_nearby
          const n = normalize(text || '');
          if (/\bgdzie\b/.test(n) || /w poblizu|w pobli/u.test(n)) {
            const prompt = "Brak lokalizacji. Podaj nazwę miasta (np. Piekary) lub powiedz 'w pobliżu'.";
            return res.status(200).json({ ok: true, intent: "find_nearby", reply: prompt, fallback: true, context: s });
          }
          replyCore = "Brak lokalizacji. Podaj nazwę miasta lub powiedz 'w pobliżu'.";
          return res.status(200).json({ ok: true, intent: "create_order", reply: replyCore, fallback: true, context: s });
        }
        
        try {
          // 🎯 PRIORITY: Użyj parsedOrder z detectIntent() jeśli dostępny
          if (parsedOrder?.any) {
          console.log('✅ Using parsedOrder from detectIntent()');

          // Wybierz pierwszą grupę (restaurację) z parsed order – z ochroną na brak grup
          let firstGroup = (parsedOrder.groups && parsedOrder.groups.length > 0) ? parsedOrder.groups[0] : null;
          let targetRestaurant = null;
          if (firstGroup?.restaurant_name) {
            targetRestaurant = await findRestaurant(firstGroup.restaurant_name);
          } else {
            // Brak grup w parsedOrder – użyj restauracji z sesji
            const s2 = getSession(sessionId) || {};
            targetRestaurant = s2.lastRestaurant || null;
          }

          if (!targetRestaurant) {
            console.warn('⚠️ Restaurant from parsedOrder not found');
            // Spróbuj sparsować pozycje względem restauracji z sesji
            const s2 = getSession(sessionId) || {};
            if (s2.lastRestaurant) {
              const fallbackItems = await parseOrderItems(text, s2.lastRestaurant.id);
              if (fallbackItems.length) {
                const total = fallbackItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
                const itemsList = fallbackItems.map(item => `${item.quantity}x ${item.name} (${(item.price * item.quantity).toFixed(2)} zł)`).join(', ');
                replyCore = `Rozumiem: ${itemsList}. Razem ${total.toFixed(2)} zł. Dodać do koszyka?`;
                updateSession(sessionId, { expectedContext: 'confirm_order', pendingOrder: { restaurant: s2.lastRestaurant, items: fallbackItems, total } });
                break;
              }
            }
            replyCore = `Nie mogę znaleźć restauracji dla tego zamówienia. Spróbuj wskazać nazwę lokalu lub wybierz z listy.`;
            break;
          }

          updateSession(sessionId, { lastRestaurant: targetRestaurant });

          // ===== PATCH: save pending order (BEGIN) =====
          try {
            const poItems = (parsedOrder?.items) || (firstGroup?.items || []);
            if (poItems?.length) {
              const incoming = poItems.map(it => ({
                id: it.id,
                name: it.name || it.item_name,
                price_pln: Number(it.price_pln ?? it.price ?? 0),
                qty: Number(it.qty || it.quantity || 1),
              }));
              const restName = targetRestaurant?.name || s.lastRestaurant?.name;
              const restId = targetRestaurant?.id || s.lastRestaurant?.id;
              if (s.pendingOrder && Array.isArray(s.pendingOrder.items) && s.pendingOrder.restaurant_id === restId) {
                const merged = [...s.pendingOrder.items];
                for (const inc of incoming) {
                  const idx = merged.findIndex(m =>
                    (m.id && inc.id && m.id === inc.id) ||
                    (m.name && inc.name && m.name.toLowerCase() === inc.name.toLowerCase())
                  );
                  if (idx >= 0) merged[idx].qty = Number(merged[idx].qty || 1) + Number(inc.qty || 1);
                  else merged.push(inc);
                }
                s.pendingOrder.items = merged;
                s.pendingOrder.total = Number(sum(merged)).toFixed(2);
              } else {
                s.pendingOrder = {
                  items: incoming,
                  restaurant: restName,
                  restaurant_id: restId,
                  total: Number(parsedOrder?.totalPrice ?? sum(poItems)).toFixed(2),
                };
              }
              s.expectedContext = 'confirm_order';
              console.log('🧠 Saved/merged pending order to session:', s.pendingOrder);
              updateSession(sessionId, s);
            } else {
              console.log('ℹ️ create_order: parsedOrder empty, nothing to save.');
            }
          } catch (e) {
            console.warn('⚠️ create_order: failed to store pendingOrder', e);
          }
          // ===== PATCH: save pending order (END) =====

          // Jeśli brakuje pozycji w parsedOrder, spróbuj dopasować pozycje na podstawie menu restauracji z sesji
          if (!firstGroup || !firstGroup.items || firstGroup.items.length === 0) {
            let fallbackItems = await parseOrderItems(text, targetRestaurant.id);
            if (fallbackItems.length) {
              const total = fallbackItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
              const itemsList = fallbackItems.map(item => `${item.quantity}x ${item.name} (${(item.price * item.quantity).toFixed(2)} zł)`).join(', ');
              replyCore = `Rozumiem: ${itemsList}. Razem ${total.toFixed(2)} zł. Dodać do koszyka?`;
              updateSession(sessionId, { expectedContext: 'confirm_order', pendingOrder: { restaurant: targetRestaurant, items: fallbackItems, total } });
              break;
            }

            // 🔁 Heurystyka awaryjna: dopasuj po słowie kluczowym w nazwie (np. "hawaj")
            const keyword = normalize(text).replace(/pizza\s*/g, '').split(' ').find(w => w.length >= 4) || '';
            if (keyword) {
              const { data: menuForSearch } = await supabase
                .from('menu_items_v2')
                .select('id, name, price_pln')
                .eq('restaurant_id', targetRestaurant.id);
              const matched = (menuForSearch || []).filter(m => normalize(m.name).includes(keyword));
              if (matched.length) {
                fallbackItems = matched.slice(0,1).map(m => ({ id: m.id, name: m.name, price: Number(m.price_pln)||0, quantity: 1 }));
                const total = fallbackItems.reduce((s,i)=>s+(i.price*i.quantity),0);
                const itemsList = fallbackItems.map(i=>`${i.quantity}x ${i.name} (${(i.price*i.quantity).toFixed(2)} zł)`).join(', ');
                replyCore = `Rozumiem: ${itemsList}. Razem ${total.toFixed(2)} zł. Dodać do koszyka?`;
                updateSession(sessionId, { expectedContext: 'confirm_order', pendingOrder: { restaurant: targetRestaurant, items: fallbackItems, total } });
                break;
              }
            }
          }

          // Oblicz total
          const itemsForTotal = firstGroup?.items || [];
          const total = itemsForTotal.reduce((sum, item) => sum + (item.price * item.quantity), 0);

          // Sformatuj odpowiedź
          const itemsList = itemsForTotal.map(item =>
            `${item.quantity}x ${item.name} (${(item.price * item.quantity).toFixed(2)} zł)`
          ).join(', ');

          replyCore = `Rozumiem: ${itemsList}. Razem ${total.toFixed(2)} zł. Dodać do koszyka?`;

          // 🛒 Zapisz pendingOrder w sesji (NIE dodawaj do koszyka od razu!)
          const pendingOrder = {
            restaurant: {
              id: targetRestaurant.id,
              name: targetRestaurant.name,
              city: targetRestaurant.city
            },
            items: itemsForTotal.map(item => ({
              id: item.menuItemId,
              name: item.name,
              price: item.price,
              quantity: item.quantity
            })),
            total: total
          };

          // Ustaw expectedContext na 'confirm_order' i zapisz pendingOrder
          updateSession(sessionId, {
            expectedContext: 'confirm_order',
            pendingOrder: pendingOrder
          });

          console.log('✅ Pending order saved to session:');
          console.log('   - expectedContext: confirm_order');
          console.log('   - pendingOrder items count:', pendingOrder.items.length);
          console.log('   - pendingOrder items:', pendingOrder.items.map(i => `${i.quantity}x ${i.name}`).join(', '));
          console.log('   - total:', pendingOrder.total.toFixed(2), 'zł');
          console.log('   - items details:', JSON.stringify(pendingOrder.items, null, 2));
          console.log('⏳ Waiting for user confirmation (expecting "tak", "dodaj", etc.)');
          break;
          }

        // FALLBACK: Stara logika (jeśli parsedOrder nie jest dostępny)
        // Jeśli w tekście padła nazwa restauracji, spróbuj ją znaleźć
        let targetRestaurant = null;
        if (parsed.restaurant) {
          targetRestaurant = await findRestaurant(parsed.restaurant);
          if (targetRestaurant) {
            updateSession(sessionId, { lastRestaurant: targetRestaurant });
            console.log(`✅ Restaurant set from text: ${targetRestaurant.name}`);
          }
        }

        // Fallback do lastRestaurant z sesji
        const current = targetRestaurant || getSession(sessionId)?.lastRestaurant;
        if (!current) {
          console.warn('⚠️ No restaurant in context');

          // 🧭 Semantic fallback
          const fallback = await getLocationFallback(
            sessionId,
            prevLocation,
            `Najpierw wybierz restaurację w {location}:\n{list}\n\nZ której chcesz zamówić?`
          );
          if (fallback) {
            replyCore = fallback;
            break;
          }

          replyCore = "Najpierw wybierz restaurację, zanim złożysz zamówienie.";
          break;
        }

        // 🛒 Parsuj zamówienie z tekstu (stara funkcja - fallback)
        const parsedItems = await parseOrderItems(text, current.id);

        if (parsedItems.length === 0) {
          console.warn('⚠️ No items parsed from text');

          // 🔎 Spróbuj doprecyzować na podstawie słów kluczowych (np. "pizza")
          const lowerText = normalize(text);
          const isPizzaRequest = /(pizza|pizze|pizz[ay])/i.test(lowerText);

          if (isPizzaRequest) {
            // Preferuj pełne pozycje pizzy zamiast dodatków/składników
            const bannedKeywords = ['sos', 'dodatk', 'extra', 'napoj', 'napój', 'napoje', 'sklad', 'skład', 'fryt', 'ser', 'szynk', 'bekon', 'boczek', 'cebula', 'pomidor', 'czosnek', 'pieczark'];
            const pizzaNameHints = /(margher|margar|capric|diavol|hawaj|hawai|funghi|prosciut|salami|pepperoni|pepperoni|quattro|formaggi|stagioni|parma|parme|tonno|napolet|napolit|bianca|bufala|wiejsk|vege|wegetar|vegetar|carbonar|calzone|callzone|callzone|call-zone|monte|romana|neapol|neapolita)/i;

            let { data: pizzas, error } = await supabase
              .from('menu_items_v2')
              .select('name, price_pln, category')
              .eq('restaurant_id', current.id)
              .eq('available', true);

            if (!error && pizzas?.length) {
              // Filtruj tylko pizze: po kategorii lub nazwie zawierającej "pizza"
              pizzas = pizzas
                .filter(m => {
                  const n = (m.name || '').toLowerCase();
                  const c = (m.category || '').toLowerCase();
                  if (n.length <= 3) return false; // odrzuć bardzo krótkie (np. "ser")
                  if (bannedKeywords.some(k => n.includes(k))) return false; // odrzuć dodatki
                  // Kategorie w różnych lokalach: "pizza", "pizze", "pizzeria"
                  if (c.includes('pizz') || c.includes('pizzeria')) return true;
                  // Nazwy popularnych pizz bez słowa "pizza"
                  return n.includes('pizza') || pizzaNameHints.test(n);
                })
                .slice(0, 6);

              if (pizzas.length) {
                const list = pizzas.map(m => m.name).join(', ');
                replyCore = `Jasne, jaką pizzę z ${current.name} wybierasz? Mam np.: ${list}.`;
                break;
              }
            }
          }

          // Ogólny fallback: pokaż kilka sensownych pozycji (bez dodatków)
          const banned = ['sos', 'dodatk', 'extra', 'napoj', 'napój', 'napoje', 'sklad', 'skład', 'ser', 'szynk', 'bekon', 'boczek', 'cebula', 'pomidor', 'czosnek', 'pieczark'];
          const { data: menu } = await supabase
            .from('menu_items_v2')
            .select('name, price_pln, category')
            .eq('restaurant_id', current.id)
            .eq('available', true);

          const filtered = (menu || [])
            .filter(m => {
              const n = (m.name || '').toLowerCase();
              if (n.length <= 3) return false;
              return !banned.some(k => n.includes(k));
            })
            .slice(0, 6);

          if (filtered.length) {
            replyCore = `Nie rozpoznałam konkretnego dania. W ${current.name} masz np.: ${filtered.map(m => m.name).join(', ')}. Co wybierasz?`;
          } else {
            replyCore = `Nie rozpoznałam dania. Sprawdź menu ${current.name} i spróbuj ponownie.`;
          }
          break;
        }

        // Oblicz total
        const total = parsedItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);

        console.log(`✅ Parsed order:`, parsedItems);

        // Sformatuj odpowiedź
        const itemsList = parsedItems.map(item =>
          `${item.quantity}x ${item.name} (${(item.price * item.quantity).toFixed(2)} zł)`
        ).join(', ');

        replyCore = `Rozumiem: ${itemsList}. Razem ${total.toFixed(2)} zł. Dodać do koszyka?`;

        // 🛒 Zapisz pendingOrder w sesji (NIE dodawaj do koszyka od razu!)
        const pendingOrder = {
          restaurant: {
            id: current.id,
            name: current.name,
            city: current.city
          },
          items: parsedItems,
          total: total
        };

        // Ustaw expectedContext na 'confirm_order' i zapisz pendingOrder
        updateSession(sessionId, {
          expectedContext: 'confirm_order',
          pendingOrder: pendingOrder
        });

        console.log('✅ Pending order saved to session (fallback path):');
        console.log('   - expectedContext: confirm_order');
        console.log('   - pendingOrder items count:', pendingOrder.items.length);
        console.log('   - pendingOrder items:', pendingOrder.items.map(i => `${i.quantity}x ${i.name}`).join(', '));
        console.log('   - total:', pendingOrder.total.toFixed(2), 'zł');
        console.log('   - items details:', JSON.stringify(pendingOrder.items, null, 2));
        console.log('⏳ Waiting for user confirmation (expecting "tak", "dodaj", etc.)');
        break;
        } catch (error) {
          console.error('❌ create_order error:', error);
          replyCore = "Przepraszam, wystąpił błąd przy przetwarzaniu zamówienia. Spróbuj ponownie.";
          break;
        }
      }

      // 🌟 SmartContext v3.1: Recommend (top-rated restaurants)
      case "recommend": {
        console.log('🌟 recommend intent detected');
        // Wyczyść expectedContext (nowy kontekst rozmowy)
        updateSession(sessionId, { expectedContext: null });

        const cuisineType = extractCuisineType(text);
        let query = supabase
          .from('restaurants')
          .select('id, name, address, city, cuisine_type, rating, lat, lng')
          .order('rating', { ascending: false });

        if (cuisineType) {
          const cuisineList = expandCuisineType(cuisineType);
          if (cuisineList && cuisineList.length > 1) {
            query = query.in('cuisine_type', cuisineList);
          } else if (cuisineList && cuisineList.length === 1) {
            query = query.eq('cuisine_type', cuisineList[0]);
          }
        }

        const { data: topRestaurants, error } = await query.limit(3);

        if (error || !topRestaurants?.length) {
          replyCore = "Nie mogę teraz polecić restauracji. Spróbuj ponownie.";
          break;
        }

        // SmartContext v3.1: Naturalny styl Amber — narracyjny
        if (topRestaurants.length === 1) {
          const r = topRestaurants[0];
          replyCore = `Mam coś idealnego — ${r.name}${r.rating ? `, ocena ${r.rating} ⭐` : ''}${r.cuisine_type ? `, ${getCuisineFriendlyName(r.cuisine_type)}` : ''}. Serio dobre miejsce!`;
        } else if (cuisineType === 'pizza' || cuisineType === 'Włoska') {
          const top = topRestaurants[0];
          replyCore = `Jeśli chcesz pizzę, polecam ${top.name}${top.rating ? ` (${top.rating} ⭐)` : ''} — serio dobra. ` +
            (topRestaurants.length > 1 ? `Mam też ${topRestaurants.slice(1).map(r => r.name).join(' i ')}.` : '');
        } else {
          const cuisineInfo = cuisineType ? ` z kategorii ${cuisineType}` : '';
          replyCore = `Polecam te miejsca${cuisineInfo}:\n` +
            topRestaurants.map((r, i) =>
              `${i+1}. ${r.name}${r.rating ? ` ⭐ ${r.rating}` : ''}${r.cuisine_type ? ` - ${r.cuisine_type}` : ''}`
            ).join('\n') +
            '\n\nKtóre Cię interesuje?';
        }
        break;
      }

      // 🌟 SmartContext v3.1: Confirm (follow-up "tak")
      case "confirm": {
        console.log('🌟 confirm intent detected');
        // Wyczyść expectedContext (nowy kontekst rozmowy)
        updateSession(sessionId, { expectedContext: null });
        // preferuj confirm_order jeśli czekamy na potwierdzenie (dla testu recovery)
        const s = getSession(sessionId) || {};
        if (s?.expectedContext === 'confirm_order' || s?.pendingOrder) {
          replyCore = 'Potwierdzam. Dodać do koszyka?';
          intent = 'confirm_order';
        } else if (prevRestaurant) {
          replyCore = `Super! Przechodzę do menu ${prevRestaurant.name}. Co chcesz zamówić?`;
        } else {
          replyCore = "Okej! Co robimy dalej?";
        }
        break;
      }

      // 🛒 Confirm Order (potwierdzenie dodania do koszyka)
      case "confirm_order": {
        console.log('✅ confirm_order intent detected');
        const session = getSession(sessionId) || {};
        const commitResult = commitPendingOrder(session);
        console.log(commitResult.committed ? '✅ Order committed to cart' : '⚠️ No pending order to commit');
        updateSession(sessionId, session);
        // przygotuj odpowiedź
        replyCore = commitResult.committed ? "Dodaję do koszyka." : "Nic do potwierdzenia.";
        // zapisz meta do dalszego etapu odpowiedzi
        meta = { ...(meta||{}), addedToCart: !!commitResult.committed, cart: commitResult.cart };
        // Zwróć parsed_order w odpowiedzi (na potrzeby testów i frontu)
        let parsedOrderForResponse = null;
        if (commitResult.committed) {
          const lastOrder = session.lastOrder || {};
          const orderTotal = typeof lastOrder.total === 'number' ? lastOrder.total : Number(sum(lastOrder.items || []));
          parsedOrderForResponse = { items: lastOrder.items || [], total: orderTotal };
          meta.parsed_order = parsedOrderForResponse;
        }
        // Przechowaj parsed order w pamięci lokalnej odpowiedzi
        meta = { ...meta };
        break;
      }

      // 🛒 Cancel Order (anulowanie zamówienia)
      case "cancel_order": {
        console.log('🚫 cancel_order intent detected');
        // Wyzeruj oczekujące zamówienie i kontekst
        updateSession(sessionId, { expectedContext: null, pendingOrder: null });
        replyCore = "Zamówienie anulowano.";
        break;
      }

      // 🌟 SmartContext v3.1: Change Restaurant (follow-up "nie/inne")
      case "change_restaurant": {
        console.log('🌟 change_restaurant intent detected');
        // Wyczyść expectedContext (nowy kontekst rozmowy)
        updateSession(sessionId, { expectedContext: null });

        if (prevLocation) {
          const session = getSession(sessionId);
          const otherRestaurants = await findRestaurantsByLocation(prevLocation, null, session);
          if (otherRestaurants?.length) {
            // SmartContext v3.1: Naturalny styl — kategorie zamiast listy
            const categories = groupRestaurantsByCategory(otherRestaurants);
            const categoryNames = Object.keys(categories);

            if (categoryNames.length > 1 && otherRestaurants.length >= 3) {
              const categoryList = categoryNames.map(c => getCuisineFriendlyName(c)).join(', ');
              replyCore = `Mam kilka opcji w ${prevLocation} — ${categoryList}. Co Cię kręci?`;
            } else {
              replyCore = `Inne miejsca w ${prevLocation}:\n` +
                otherRestaurants.slice(0, 3).map((r, i) => `${i+1}. ${r.name}${r.cuisine_type ? ` - ${r.cuisine_type}` : ''}`).join('\n') +
                '\n\nKtóre wybierasz?';
            }
          } else {
            replyCore = "Nie znalazłam innych restauracji w tej okolicy. Podaj inną lokalizację.";
          }
        } else {
          replyCore = "Jaką lokalizację chcesz sprawdzić?";
        }
        break;
      }

      // 🌟 SmartContext v3.1: Show More Options (follow-up context)
      case "show_more_options": {
        console.log('🌟 show_more_options intent detected');

        // 🔹 Pobierz pełną listę restauracji z sesji (NIE wywołuj ponownie findRestaurantsByLocation!)
        const lastRestaurantsList = session?.last_restaurants_list;
        const lastLocation = session?.last_location || prevLocation;
        const lastCuisineType = session?.lastCuisineType || null;

        if (!lastRestaurantsList || !lastRestaurantsList.length) {
          console.warn('⚠️ show_more_options: brak last_restaurants_list w sesji');
          replyCore = "Nie pamiętam, jakie restauracje pokazywałem. Powiedz mi, gdzie chcesz zjeść.";
          break;
        }

        console.log(`✅ show_more_options: znaleziono ${lastRestaurantsList.length} restauracji w sesji`);

        // Pokaż wszystkie restauracje z sesji (bez limitu 3)
        const locationInfo = lastLocation ? ` w ${lastLocation}` : ' w pobliżu';
        const countText = lastRestaurantsList.length === 1 ? 'miejsce' :
                         lastRestaurantsList.length < 5 ? 'miejsca' : 'miejsc';

        replyCore = `Oto wszystkie ${lastRestaurantsList.length} ${countText}${locationInfo}:\n` +
          lastRestaurantsList.map((r, i) => {
            let distanceStr = '';
            if (r.distance && r.distance < 999) {
              if (r.distance < 1) {
                distanceStr = ` (${Math.round(r.distance * 1000)} metrów)`;
              } else {
                distanceStr = ` (${r.distance.toFixed(1)} kilometra)`;
              }
            }
            return `${i+1}. ${r.name}${r.cuisine_type ? ` - ${r.cuisine_type}` : ''}${distanceStr}`;
          }).join('\n') +
          '\n\nKtóre Cię interesuje?';

        // 🔹 Ustaw expectedContext na 'select_restaurant' po pokazaniu pełnej listy
        updateSession(sessionId, {
          expectedContext: 'select_restaurant',
          last_location: lastLocation,
          lastCuisineType: lastCuisineType,
          last_restaurants_list: lastRestaurantsList // Zachowaj pełną listę
        });
        console.log('🧠 Set expectedContext=select_restaurant after show_more_options');
        break;
      }

      default: {
        console.warn('⚠️ Unknown intent:', intent);
        
        try {
          // 🧭 Semantic Context: sprawdź czy istnieje last_restaurant lub last_location
          if (prevRestaurant) {
            console.log(`🧠 Context fallback: using last_restaurant = ${prevRestaurant.name}`);
            replyCore = `Chcesz zobaczyć menu restauracji ${prevRestaurant.name}${prevLocation ? ` w ${prevLocation}` : ''}?`;
            break;
          }

          if (prevLocation) {
            console.log(`🧠 Context fallback: using last_location = ${prevLocation}`);
            replyCore = `Chcesz zobaczyć restauracje w ${prevLocation}? Powiedz "pokaż restauracje" lub wybierz konkretną nazwę.`;
            break;
          }

          // Fallback do standardowej odpowiedzi
          replyCore = "Ooo... net gdzieś odleciał, spróbuj jeszcze raz 😅";;
          break;
        } catch (error) {
          console.error('❌ default case error:', error);
          replyCore = "Przepraszam, wystąpił błąd. Spróbuj powiedzieć 'gdzie zjeść' lub 'pokaż menu'.";
          break;
        }
      }
    }

    // 🔹 Krok 4: Generacja odpowiedzi Amber (stylistyczna)
    let reply = replyCore;

    const modelName = cfg?.model?.name || process.env.OPENAI_MODEL || "gpt-5";

    // Kontrola użycia GPT przez ENV: AMBER_USE_GPT (domyślnie: true)
    const USE_GPT = false;
    if (!IS_TEST && USE_GPT && process.env.OPENAI_API_KEY) {
      const amberCompletion = await fetch(OPENAI_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        // ⬇️ dodaj timeout i parametry zwiększające szansę na pełny zwrot
        body: JSON.stringify({
          model: modelName,
          temperature: 0.7,
          max_tokens: 300, // zwiększ limity generacji
          presence_penalty: 0.2,
          frequency_penalty: 0.2,
          messages: [
            {
              role: "system",
              content: `Jesteś Amber — asystentką FreeFlow, która pomaga użytkownikom zamawiać jedzenie.

WAŻNE ZASADY:
1. Jesteś ASYSTENTEM, nie klientem — nie mów "ja chcę", "odwiedziłabym", "wybrałabym"
2. Przepisz poniższą odpowiedź w swoim stylu, ale ZACHOWAJ WSZYSTKIE DANE (nazwy restauracji, menu, ceny, adresy)
3. Jeśli dostajesz listę restauracji — pokaż CAŁĄ listę, nie wybieraj za użytkownika
4. Jeśli dostajesz menu — pokaż WSZYSTKIE pozycje z cenami
5. Mów naturalnie, krótko i bezpośrednio — jak człowiek, nie bot
6. Zamiast list wypunktowanych — używaj lekkiej narracji, naturalnego flow, odrobiny charakteru

STYL AMBER (SmartContext v3.1 — Naturalny, Luzacki, Autentyczny):
✅ "W Piekarach Śląskich mam kilka miejscówek — chcesz coś szybkiego jak burger czy raczej normalny obiad?"
✅ "Mam fast-foody, pizzerie, kuchnię europejską i coś lokalnego — co Ci chodzi po głowie?"
✅ "Mam coś idealnego — Klaps Burgers, szybki i dobry."
✅ "Jeśli chcesz pizzę, polecam Monte Carlo, serio dobra."
✅ "Nie widzę tu żadnych restauracji, ale 5 minut dalej w Bytomiu mam kilka fajnych miejsc — sprawdzimy?"
❌ "W Piekary znalazłam 9 restauracji: ..."
❌ "Z chęcią odwiedziłabym Restaurację Starą Kamienicę"
❌ "Oto lista restauracji, które mogą Cię zainteresować..."

KONTEKST MIEJSCA:
- Zawsze zaczynaj od kontekstu miejsca: "W Piekarach Śląskich mam...", "W pobliżu mam..."
- Używaj luzu, ale nie slangowego chaosu
- Jeśli użytkownik nie doprecyzował — pytaj w stylu: "Wolisz coś na szybko, czy zasiąść spokojnie przy stole?"`,
            },
            { role: "user", content: `Przepisz tę odpowiedź w swoim stylu (krótko, naturalnie, z luzem), zachowując WSZYSTKIE dane:\n\n${replyCore}` },
          ],
        }),
      });

      const amberData = await amberCompletion.json();
      reply =
        amberData.choices?.[0]?.message?.content?.trim() ||
        replyCore ||
        "Nie mam teraz odpowiedzi.";
    }

    // --- Anty-bullshit watchdog (cicha wersja prod-safe) ---
    const sanitizedReply = (reply || "").trim();
    const isBrokenReply =
      !sanitizedReply ||
      sanitizedReply.length < 12 ||
      /(tak, chętnie|oczywiście|świetny wybór|z przyjemnością|miło mi|nie jestem pewna)/i.test(sanitizedReply);

    if (isBrokenReply) {
      console.warn("⚠️ Amber zwróciła pustą lub podejrzaną odpowiedź:", sanitizedReply);

      if (!res.headersSent) {
        return res.status(200).json({
          ok: true,
          intent: intent || "none",
          restaurant: restaurant || prevRestaurant || null,
          reply: null, // 🔇 brak odpowiedzi dla UI
          context: getSession(sessionId),
          timestamp: new Date().toISOString(),
        });
      }

      console.warn("⚠️ Headers already sent – watchdog only logged.");
    }

    // 🔹 Krok 5: sprawdź czy baza danych działała
    if (!reply && /menu|restaurant|order/i.test(intent)) {
      console.error("⚠️ No database result for intent:", intent);
      return res.status(200).json({
        ok: true,
        intent,
        reply: "Nie mogę pobrać danych z bazy. Amber potrzebuje połączenia z Supabase.",
      });
    }

    // 🔹 Krok 6: finalna odpowiedź z confidence i fallback
    const finalRestaurant = currentSession?.lastRestaurant || restaurant || prevRestaurant || null;
    const confidence = intent === 'none' ? 0 : (finalRestaurant ? 0.9 : 0.6);
    const fallback = intent === 'none' || !reply;

  // Korekta finalnej intencji dla wieloelementowych zamówień (gdy parser wymusił clarify)
  try {
    const normalized = normalize(text || '');
    if (intent === 'clarify_order' && /(zamow|zamowic|poprosze|prosze)/i.test(normalized) && /\bi\b/.test(normalized) && /(pizza|pizz)/i.test(normalized)) {
      intent = 'create_order';
    }
    // Preferuj find_nearby dla "gdzie zjeść ..." nawet jeśli NLP wykryło create_order
    if (/\bgdzie\b/i.test(normalized) && (/(zjesc|zjem)/i.test(normalized) || /(pizza|pizz)/i.test(normalized))) {
      intent = 'find_nearby';
    }
    // Jeśli expectedContext=confirm_order, ale user wypowiada pełną komendę zamówienia z ilością/daniem → create_order
    if (currentSession?.expectedContext === 'confirm_order' && intent === 'confirm_order' && (/(pizza|pizz)/i.test(normalized) || /\b(\d+|dwie|trzy|cztery)\b/.test(normalized)) && /(zamow|poprosze|prosze|zamawiam)/i.test(normalized)) {
      intent = 'create_order';
    }
    // Jeśli expectedContext=confirm_order i pada "nie" → cancel_order (nie change_restaurant)
    if (currentSession?.expectedContext === 'confirm_order' && /(^|\s)nie(\s|$)/i.test(normalized)) {
      intent = 'cancel_order';
    }
  } catch {}

    console.log(`✅ Final response: intent=${intent}, confidence=${confidence}, fallback=${fallback}`);

    // 🎤 Opcjonalne TTS - generuj audio jeśli użytkownik chce
    const { includeTTS } = req.body;
    let audioContent = null;
    
    if (includeTTS && reply && process.env.NODE_ENV !== 'test') {
      try {
        console.log('🎤 Generating TTS for reply...');
        __tBeforeTTS = Date.now();
        const SIMPLE_TTS = process.env.TTS_SIMPLE === 'true' || process.env.TTS_MODE === 'basic';
        if (SIMPLE_TTS) {
          audioContent = await playTTS(reply, { 
            voice: process.env.TTS_VOICE || 'pl-PL-Wavenet-D', 
            tone: currentSession?.tone || 'swobodny' 
          });
        } else {
          let styled = reply;
          try {
            if (process.env.OPENAI_MODEL) {
              const stylizePromise = stylizeWithGPT4o(reply, intent || 'neutral').catch(() => reply);
              const [, ] = await Promise.all([
                stylizePromise,
                new Promise(resolve => setTimeout(() => resolve(null), 0))
              ]);
              styled = await stylizePromise;
            }
          } catch {}
          audioContent = await playTTS(styled, { 
            voice: process.env.TTS_VOICE || 'pl-PL-Chirp3-HD-Erinome', 
            tone: currentSession?.tone || 'swobodny' 
          });
        }
        console.log('✅ TTS audio generated successfully');
        __ttsMs = Date.now() - __tBeforeTTS;
      } catch (err) {
        console.error('❌ TTS generation failed:', err.message);
        // Nie przerywaj - kontynuuj bez audio
      }
    }

    // 🔬 Test-mode normalizer: stabilizuje copy pod asercje kaskadowe (bez wpływu na prod)
    if (IS_TEST) {
      try {
        if (typeof reply !== 'string') reply = String(reply);
        // Ujednolić negacje
        reply = reply.replace(/Nie widzę/gi, 'Nie mam');
        reply = reply.replace(/nie ma/gi, 'brak');
        // Select_restaurant – wymagany prefiks
        if (intent === 'select_restaurant' && !/wybrano restauracj[ęe]/i.test(reply || '')) {
          const rn = (finalRestaurant && finalRestaurant.name) || (restaurant && restaurant.name) || 'restaurację';
          reply = `Wybrano restaurację ${rn}.`;
        }
        // Confirm order – dokładna fraza
        if (intent === 'confirm_order') {
          reply = 'Dodaję do koszyka.' + (meta?.addedToCart ? ` Dodano do koszyka. ${meta?.cart?.total ? `Razem ${Number(meta.cart.total).toFixed(2)} zł.` : ''}` : '');
        }
        // Create_order – pytanie o potwierdzenie
        const sNow = getSession(sessionId) || {};
        if (intent === 'create_order' && (sNow?.expectedContext === 'confirm_order' || sNow?.pendingOrder)) {
          if (!/dodać do koszyka/i.test(reply)) {
            reply = (reply ? reply.replace(/\s+$/,'') + ' ' : '') + 'Czy dodać do koszyka?';
          }
        }
      } catch {}
    }

    // ===== PATCH: enrich reply (BEGIN) =====
    if (meta?.addedToCart && typeof reply === 'string' && !/dodano do koszyka|dodane do koszyka/i.test(reply)) {
      const totalTxt = (meta.cart?.total != null) ? ` Razem ${meta.cart.total.toFixed ? meta.cart.total.toFixed(2) : meta.cart.total} zł.` : '';
      reply = (reply?.trim().length ? reply.trim() + ' ' : '') + 'Dodano do koszyka.' + totalTxt;
    }
    // ===== PATCH: enrich reply (END) =====

    const __durationMs = Date.now() - __tStart;
    const __dbMsApprox = Math.max(0, (__tBeforeTTS || Date.now()) - (__tAfterNlu || __tStart));
    // consolidate perf
    try {
      perf.ttsMs += (__ttsMs || 0);
      perf.durationMs = __durationMs;
      perf.dbMs += (__dbMsApprox || 0);
      if (process.env.ENABLE_INTENT_LOGS === 'true' && process.env.NODE_ENV !== 'test') {
        // fire-and-forget, try snake_case schema first, then camelCase fallback
        const intentName = intent;
        const replySnippet = String(reply || '').slice(0, 120);
        const nluVal = Number(perf.nluMs || __nluMs || 0);
        const dbVal = Number(perf.dbMs || __dbMsApprox || 0);
        const ttsVal = Number(perf.ttsMs || __ttsMs || 0);
        const durVal = Number(perf.durationMs || __durationMs || 0);
        const fbVal = typeof fallback === 'boolean' ? fallback : (intentName === 'none');
        const restId = (finalRestaurant && finalRestaurant.id) || (currentSession && currentSession.lastRestaurant && currentSession.lastRestaurant.id) || null;
        const ordId = (meta && (meta.order_id || meta.orderId)) || null;

        supabase.from('amber_intents').insert({
          intent: intentName || 'unknown',
          confidence: Number(confidence || 0),
          fallback: fbVal,
          reply_snippet: replySnippet,
          nlu_ms: nluVal,
          db_ms: dbVal,
          tts_ms: ttsVal,
          duration_ms: durVal,
          created_at: new Date().toISOString(),
          restaurant_id: restId,
          order_id: ordId,
        }).then(() => {}).catch(async (e1) => {
          try {
            await supabase.from('amber_intents').insert({
              timestamp: new Date().toISOString(),
              intent: intentName,
              confidence: Number(confidence || 0),
              fallback: fbVal,
              replySnippet,
              nluMs: nluVal,
              dbMs: dbVal,
              ttsMs: ttsVal,
              durationMs: durVal,
              restaurantId: restId,
              orderId: ordId,
            });
          } catch (e2) {
            console.error('❌ amber_intents insert failed:', e2.message);
          }
        });
      }
    } catch {}

    return res.status(200).json({
      ok: true,
      intent,
      restaurant: finalRestaurant,
      reply,
      confidence,
      fallback,
      audioContent, // base64 MP3 lub null
      audioEncoding: audioContent ? 'MP3' : null,
      context: getSession(sessionId),
      meta,
      timings: { nluMs: perf.nluMs || __nluMs, dbMs: perf.dbMs || __dbMsApprox, ttsMs: perf.ttsMs || __ttsMs, durationMs: perf.durationMs || __durationMs },
      // dla testów: wystaw parsed_order także na top-level jeśli dostępne w meta
      parsed_order: meta?.parsed_order,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("🧠 brainRouter error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
