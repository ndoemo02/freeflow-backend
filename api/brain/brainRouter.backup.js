// /api/brain/brainRouter.js
import { detectIntent, normalizeTxt } from "./intent-router.js";
import { supabase } from "../_supabase.js";
import { getSession, updateSession } from "./context.js";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MODEL = "gpt-4o-mini";

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
  const menuPattern = /(?:pokaż\s+)?menu\s+(?:w\s+)?([A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż\s]+)/i;
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
      .from('menu_items')
      .select('id, name, price, description')
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
      .from('menu_items')
      .select('id, name, price, description')
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
          price: parseFloat(menuItem.price),
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
            price: parseFloat(matched.price),
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
function extractLocation(text) {
  const locationKeywords = ['w', 'na', 'blisko', 'koło', 'niedaleko', 'obok', 'przy'];
  const pattern = new RegExp(`(?:${locationKeywords.join('|')})\\s+([A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]+(?:\\s+[A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]+)?)`, 'i');
  const match = text.match(pattern);

  if (match) {
    let location = match[1]?.trim();

    // SmartContext v3.1: Blacklist — ignoruj słowa kluczowe, które nie są lokalizacjami
    const blacklist = ['tutaj', 'tu', 'szybko', 'pobliżu', 'okolicy', 'menu', 'coś', 'cos', 'azjatyckiego', 'azjatyckie', 'szybkiego', 'dobrego', 'innego'];
    const locationLower = location.toLowerCase();

    // Sprawdź czy location jest w blacklist lub zaczyna się od słowa z blacklist
    if (blacklist.includes(locationLower) || blacklist.some(word => locationLower.startsWith(word + ' '))) {
      return null;
    }

    // Normalizuj dopełniacz → mianownik (Piekarach → Piekary, Bytomiu → Bytom)
    location = location
      .replace(/ach$/i, 'y')    // Piekarach → Piekary
      .replace(/iu$/i, '')       // Bytomiu → Bytom
      .replace(/ie$/i, 'a')      // Katowicach → Katowice (już OK)
      .replace(/ami$/i, 'a');    // Gliwicami → Gliwice

    console.log(`🧭 Extracted location: "${location}"`);
    return location;
  }

  return null;
}

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
export function boostIntent(text, intent, confidence = 0) {
  if (!text) return intent;
  const lower = normalizeTxt(text); // używamy normalizeTxt z intent-router (stripuje diacritics)

  // Nie modyfikuj jeśli intencja jest bardzo pewna
  if (confidence >= 0.8) {
    console.log(`🧠 SmartContext: skipping boost (confidence=${confidence})`);
    return intent;
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
  if (/(\bnie\b|zmien|zmień|\binne\b|cos innego|coś innego|pokaz inne|pokaż inne|inna restaurac)/i.test(lower)) {
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
 * Znajduje restauracje w danej lokalizacji używając fuzzy matching
 * @param {string} location - Nazwa miasta/lokalizacji
 * @param {string|null} cuisineType - Opcjonalny typ kuchni do filtrowania (może być alias)
 */
async function findRestaurantsByLocation(location, cuisineType = null) {
  if (!location) return null;

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

    const { data: restaurants, error } = await query.limit(10);

    if (error) {
      console.error('⚠️ findRestaurantsByLocation error:', error.message);
      return null;
    }

    if (!restaurants?.length) {
      console.warn(`⚙️ GeoContext: brak wyników w "${location}"${cuisineType ? ` (cuisine: ${cuisineType})` : ''}`);
      return null;
    }

    console.log(`🗺️ Found ${restaurants.length} restaurants in "${location}"${cuisineType ? ` (cuisine: ${cuisineType})` : ''}`);
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
async function getLocationFallback(prevLocation, messageTemplate) {
  if (!prevLocation) return null;

  console.log(`🧭 Semantic fallback: using last_location = ${prevLocation}`);
  const locationRestaurants = await findRestaurantsByLocation(prevLocation);

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
    if (!text) return res.status(400).json({ ok: false, error: "Missing text" });

    // 🔹 Pobierz kontekst sesji (pamięć krótkotrwała)
    const session = getSession(sessionId) || {};
    const prevRestaurant = session?.lastRestaurant;
    const prevLocation = session?.last_location;

    // 🔹 Krok 0: GeoContext Layer (priorytet najwyższy — przed detectIntent)
    const geoLocation = extractLocation(text);
    const geoCuisineType = extractCuisineType(text);

    if (geoLocation) {
      console.log(`🧭 GeoContext Layer activated for: "${geoLocation}"${geoCuisineType ? ` (cuisine: ${geoCuisineType})` : ''}`);
      const geoRestaurants = await findRestaurantsByLocation(geoLocation, geoCuisineType);

      if (geoRestaurants?.length) {
        // Zapisz lokalizację do sesji
        updateSession(sessionId, {
          last_location: geoLocation,
          lastIntent: 'find_nearby',
          lastUpdated: Date.now()
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
    const { intent: rawIntent, restaurant, parsedOrder, confidence: rawConfidence } = await detectIntent(text, currentSession);
    console.log('[brainRouter] 🧠 detectIntent returned:', { rawIntent, restaurant: restaurant?.name, confidence: rawConfidence, hasParsedOrder: !!parsedOrder });

    // 🔹 Krok 1.5: SmartContext Boost — warstwa semantyczna
    // ⚠️ NIE ZMIENIAJ INTENCJI jeśli parsedOrder istnieje (early dish detection zadziałał)
    let intent = rawIntent;
    if (parsedOrder?.any) {
      console.log('🔒 SmartContext: skipping boost (parsedOrder exists)');
    } else {
      const boostedIntent = boostIntent(text, rawIntent, rawConfidence || 0.5);
      intent = boostedIntent;
      if (boostedIntent !== rawIntent) {
        console.log(`🌟 SmartContext: intent changed from "${rawIntent}" → "${boostedIntent}"`);
      }
    }

    // 🔹 Krok 1.6: parsing tekstu (raz dla wszystkich case'ów)
    const parsed = parseRestaurantAndDish(text);
    console.log('📋 Parsed:', parsed);

    // 🔹 Krok 2: zachowanie kontekstu
    updateSession(sessionId, {
      lastIntent: intent,
      lastRestaurant: restaurant || prevRestaurant || null,
      lastUpdated: Date.now(),
    });

    let replyCore = "";

    // 🔹 Krok 3: logika wysokopoziomowa
    switch (intent) {
      case "find_nearby": {
        console.log('🧠 find_nearby intent detected');

        // 🧭 GeoContext Layer: sprawdź czy w tekście jest lokalizacja
        const location = extractLocation(text);
        // 🍕 Cuisine Filter: sprawdź czy w tekście jest typ kuchni
        const cuisineType = extractCuisineType(text);
        let restaurants = null;

        if (location) {
          console.log(`🧭 GeoContext active: searching in "${location}"${cuisineType ? ` (cuisine: ${cuisineType})` : ''}`);
          restaurants = await findRestaurantsByLocation(location, cuisineType);

          if (restaurants) {
            // Zapisz lokalizację do sesji
            updateSession(sessionId, { last_location: location });
            console.log(`✅ GeoContext: ${restaurants.length} restaurants found in "${location}"${cuisineType ? ` (cuisine: ${cuisineType})` : ''}`);
          }
        }

        // Fallback: jeśli brak lokalizacji lub brak wyników, pobierz wszystkie
        if (!restaurants) {
          console.log(`⚙️ GeoContext: fallback to all restaurants${cuisineType ? ` (cuisine: ${cuisineType})` : ''}`);
          let query = supabase
            .from("restaurants")
            .select("id,name,address,city,cuisine_type");

          // Patch 2.4: Rozszerz aliasy kuchni
          if (cuisineType) {
            const cuisineList = expandCuisineType(cuisineType);
            if (cuisineList && cuisineList.length > 1) {
              query = query.in('cuisine_type', cuisineList);
            } else if (cuisineList && cuisineList.length === 1) {
              query = query.eq('cuisine_type', cuisineList[0]);
            }
          }

          const { data, error } = await query.limit(5);

          if (error) {
            console.error("⚠️ Supabase error in find_nearby:", error?.message || "Brak danych");
            replyCore = "Nie mogę pobrać danych z bazy. Sprawdź połączenie z serwerem.";
            break;
          }

          restaurants = data;
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
              replyCore = `Nie widzę nic z kategorii "${cuisineType}" w ${location}, ale 5 minut dalej w ${nearbyCities[0]} mam kilka ciekawych miejsc — sprawdzimy?`;
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
              replyCore = `Nie widzę tu żadnych restauracji, ale 5 minut dalej w ${nearbyCities[0]} mam kilka fajnych miejsc — sprawdzimy?`;
            } else {
              replyCore = `Nie znalazłam restauracji w "${location}". Spróbuj innej nazwy miasta lub powiedz "w pobliżu".`;
            }
          } else {
            replyCore = "Nie znalazłam jeszcze żadnej restauracji. Podaj nazwę lub lokalizację.";
          }
          break;
        }

        // SmartContext v3.1: Naturalny styl Amber — kategorie zamiast list
        const requestedCount = /pokaz\s+(wszystkie|5|wiecej)/i.test(text) ? restaurants.length : Math.min(3, restaurants.length);
        const displayRestaurants = restaurants.slice(0, requestedCount);

        // Grupuj restauracje po kategoriach
        const categories = groupRestaurantsByCategory(displayRestaurants);
        const categoryNames = Object.keys(categories);

        // Jeśli użytkownik zapytał o konkretną kuchnię — pokaż listę
        if (cuisineType) {
          const locationInfo = location ? ` w ${location}` : ' w pobliżu';
          const countText = displayRestaurants.length === 1 ? 'miejsce' :
                           displayRestaurants.length < 5 ? 'miejsca' : 'miejsc';

          replyCore = `Znalazłam ${displayRestaurants.length} ${countText}${locationInfo}:\n` +
            displayRestaurants.map((r, i) =>
              `${i+1}. ${r.name}${r.cuisine_type ? ` - ${r.cuisine_type}` : ''}${r.city ? ` (${r.city})` : ''}`
            ).join('\n') +
            (restaurants.length > requestedCount ? `\n\n(+${restaurants.length - requestedCount} więcej — powiedz "pokaż wszystkie")` : '') +
            '\n\nKtóre Cię interesuje?';
        }
        // Jeśli ogólne pytanie "gdzie zjeść" — pokaż kategorie
        else if (categoryNames.length > 1 && displayRestaurants.length >= 3) {
          const locationName = location || 'pobliżu';
          const categoryList = categoryNames.map(c => getCuisineFriendlyName(c)).join(', ');

          replyCore = `W ${locationName} mam kilka miejscówek — chcesz coś szybkiego jak burger czy raczej normalny obiad?\n` +
            `Mam ${categoryList} — co Ci chodzi po głowie?`;
        }
        // Jeśli mało restauracji — pokaż listę
        else {
          const locationInfo = location ? ` w ${location}` : ' w pobliżu';
          const countText = displayRestaurants.length === 1 ? 'miejsce' :
                           displayRestaurants.length < 5 ? 'miejsca' : 'miejsc';

          replyCore = `Mam ${displayRestaurants.length} ${countText}${locationInfo}:\n` +
            displayRestaurants.map((r, i) =>
              `${i+1}. ${r.name}${r.cuisine_type ? ` - ${r.cuisine_type}` : ''}${r.city ? ` (${r.city})` : ''}`
            ).join('\n') +
            (restaurants.length > requestedCount ? `\n\n(+${restaurants.length - requestedCount} więcej — powiedz "pokaż wszystkie")` : '') +
            '\n\nKtóre Cię interesuje?';
        }
        break;
      }

      case "menu_request": {
        console.log('🧠 menu_request intent detected');

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
          console.warn('⚠️ No restaurant in context');

          // 🧭 Semantic fallback
          const fallback = await getLocationFallback(
            prevLocation,
            `W {location} mam {count} restauracji. Którą wybierasz?\n{list}`
          );
          if (fallback) {
            replyCore = fallback;
            break;
          }

          replyCore = "Najpierw podaj nazwę restauracji.";
          break;
        }

        // Pobierz menu z bazy
        const { data: menu, error } = await supabase
          .from("menu_items")
          .select("id, name, price, is_available")
          .eq("restaurant_id", current.id)
          .eq("is_available", true)
          .order("name", { ascending: true })
          .limit(6);

        if (error) {
          console.error("⚠️ Supabase error in menu_request:", error?.message || "Brak danych");
          replyCore = "Nie mogę pobrać danych z bazy. Sprawdź połączenie z serwerem.";
          break;
        }

        if (!menu?.length) {
          console.warn(`⚠️ No menu items for restaurant: ${current.name}`);
          replyCore = `W bazie nie ma pozycji menu dla ${current.name}. Mogę:
1) pokazać podobne lokale,
2) dodać szybki zestaw przykładowych pozycji do testów.
Co wybierasz?`;
          break;
        }

        // Zapisz menu do sesji
        updateSession(sessionId, { last_menu: menu });
        console.log(`✅ Menu loaded: ${menu.length} items from ${current.name}`);

        replyCore = `W ${current.name} dostępne m.in.: ` +
          menu.map(m => `${m.name} (${Number(m.price).toFixed(2)} zł)`).join(", ") +
          ". Co chciałbyś zamówić?";
        break;
      }

      case "select_restaurant": {
        console.log('🧠 select_restaurant intent detected');
        const name = restaurant?.name || parsed.restaurant || "";

        if (!name) {
          console.warn('⚠️ No restaurant name provided');
          replyCore = "Podaj pełną nazwę restauracji.";
          break;
        }

        const matched = await findRestaurant(name);

        if (!matched) {
          console.warn(`⚠️ Restaurant "${name}" not found`);
          replyCore = `Nie znalazłam restauracji o nazwie „${name}”. Mogę zaproponować miejsca w pobliżu.`;
          break;
        }

        updateSession(sessionId, { lastRestaurant: matched });
        console.log(`✅ Restaurant selected: ${matched.name}`);

        replyCore = `Wybrano restaurację ${matched.name}${matched.city ? ` (${matched.city})` : ''}. Możemy przejść do menu albo od razu coś zamówić.`;
        break;
      }

      case "create_order": {
        console.log('🧠 create_order intent detected');

        // 🎯 PRIORITY: Użyj parsedOrder z detectIntent() jeśli dostępny
        if (parsedOrder?.any) {
          console.log('✅ Using parsedOrder from detectIntent()');

          // Wybierz pierwszą grupę (restaurację) z parsed order
          const firstGroup = parsedOrder.groups[0];
          const targetRestaurant = await findRestaurant(firstGroup.restaurant_name);

          if (!targetRestaurant) {
            console.warn('⚠️ Restaurant from parsedOrder not found');
            replyCore = `Nie mogę znaleźć restauracji ${firstGroup.restaurant_name}. Spróbuj ponownie.`;
            break;
          }

          updateSession(sessionId, { lastRestaurant: targetRestaurant });

          // Oblicz total
          const total = firstGroup.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);

          // Sformatuj odpowiedź
          const itemsList = firstGroup.items.map(item =>
            `${item.quantity}x ${item.name} (${(item.price * item.quantity).toFixed(2)} zł)`
          ).join(', ');

          replyCore = `Rozumiem: ${itemsList}. Razem ${total.toFixed(2)} zł. Dodać do koszyka?`;

          // Zwróć parsed_order w odpowiedzi (frontend użyje tego do dodania do CartContext)
          return res.status(200).json({
            ok: true,
            intent: 'create_order',
            restaurant: targetRestaurant,
            parsed_order: {
              restaurant: {
                id: targetRestaurant.id,
                name: targetRestaurant.name,
                city: targetRestaurant.city
              },
              items: firstGroup.items.map(item => ({
                id: item.menuItemId,
                name: item.name,
                price: item.price,
                quantity: item.quantity
              })),
              total: total
            },
            reply: replyCore,
            confidence: 0.9,
            fallback: false,
            context: getSession(sessionId),
            timestamp: new Date().toISOString(),
          });
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

          // Pokaż menu jako podpowiedź
          const { data: menu } = await supabase
            .from('menu_items')
            .select('name, price')
            .eq('restaurant_id', current.id)
            .limit(5);

          if (menu?.length) {
            replyCore = `Nie rozpoznałam dania. W ${current.name} mamy: ${menu.map(m => m.name).join(', ')}. Co chcesz zamówić?`;
          } else {
            replyCore = `Nie rozpoznałam dania. Sprawdź menu ${current.name} i spróbuj ponownie.`;
          }
          break;
        }

        // Oblicz total
        const total = parsedItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);

        // 🎯 Zwróć parsed order do frontendu (zamiast zapisywać do bazy)
        console.log(`✅ Parsed order:`, parsedItems);

        // Sformatuj odpowiedź
        const itemsList = parsedItems.map(item =>
          `${item.quantity}x ${item.name} (${(item.price * item.quantity).toFixed(2)} zł)`
        ).join(', ');

        replyCore = `Rozumiem: ${itemsList}. Razem ${total.toFixed(2)} zł. Dodać do koszyka?`;

        // Zwróć parsed_order w odpowiedzi (frontend użyje tego do dodania do CartContext)
        return res.status(200).json({
          ok: true,
          intent: 'create_order',
          restaurant: current,
          parsed_order: {
            restaurant: {
              id: current.id,
              name: current.name,
              city: current.city
            },
            items: parsedItems,
            total: total
          },
          reply: replyCore,
          confidence: 0.9,
          fallback: false,
          context: getSession(sessionId),
          timestamp: new Date().toISOString(),
        });
      }

      // 🌟 SmartContext v3.1: Recommend (top-rated restaurants)
      case "recommend": {
        console.log('🌟 recommend intent detected');

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

        if (prevRestaurant) {
          replyCore = `Super! Przechodzę do menu ${prevRestaurant.name}. Co chcesz zamówić?`;
        } else {
          replyCore = "Okej! Co robimy dalej?";
        }
        break;
      }

      // 🌟 SmartContext v3.1: Change Restaurant (follow-up "nie/inne")
      case "change_restaurant": {
        console.log('🌟 change_restaurant intent detected');

        if (prevLocation) {
          const otherRestaurants = await findRestaurantsByLocation(prevLocation);
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

      default:
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
        replyCore = "Nie jestem pewna, co masz na myśli — możesz powtórzyć?";
        break;
    }

    // 🔹 Krok 4: Generacja odpowiedzi Amber (stylistyczna)
    const amberCompletion = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      // ⬇️ dodaj timeout i parametry zwiększające szansę na pełny zwrot
      body: JSON.stringify({
        model: MODEL,
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
    const reply =
      amberData.choices?.[0]?.message?.content?.trim() ||
      replyCore ||
      "Nie mam teraz odpowiedzi.";

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

    console.log(`✅ Final response: intent=${intent}, confidence=${confidence}, fallback=${fallback}`);

    return res.status(200).json({
      ok: true,
      intent,
      restaurant: finalRestaurant,
      reply,
      confidence,
      fallback,
      context: getSession(sessionId),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("🧠 brainRouter error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
