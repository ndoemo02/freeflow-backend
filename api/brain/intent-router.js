import { supabase } from '../_supabase.js';
import { createOrder } from '../orders.js';
import { updateDebugSession } from '../debug.js';

// ——— Utils: Import from helpers ———
import {
  normalize,
  stripDiacritics,
  normalizeTxt,
  extractQuantity,
  extractSize,
  fuzzyIncludes as fuzzyIncludesHelper,
  levenshtein as levenshteinHelper
} from './helpers.js';

// Re-export for compatibility
export { normalize, stripDiacritics, normalizeTxt, extractQuantity, extractSize };

function nameHasSize(name, size) {
  if (!size) return false;
  const n = normalizeTxt(name);
  return n.includes(String(size)) || (
    size === 26 && /\b(mala|mała|small)\b/.test(n) ||
    size === 32 && /\b(srednia|średnia|medium)\b/.test(n) ||
    size === 40 && /\b(duza|duża|large)\b/.test(n)
  );
}

function baseDishKey(name) {
  let n = normalizeTxt(name);
  n = n
    .replace(/\b(\d+\s*(cm|ml|g))\b/g, ' ')
    .replace(/\b(duza|duża|mala|mała|srednia|średnia|xl|xxl|small|medium|large)\b/g, ' ')
    .replace(/\(.*?\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (n.includes('margherita')) n = 'pizza margherita';
  if (n.includes('czosnkowa')) n = 'zupa czosnkowa';
  return n;
}

function dedupHitsByBase(hits, preferredSize=null) {
  const groups = new Map();
  for (const h of hits) {
    const key = `${h.restaurant_id}::${baseDishKey(h.name)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(h);
  }
  const selected = [];
  const clarifications = [];

  for (const [, arr] of groups) {
    if (arr.length === 1) {
      selected.push(arr[0]);
      continue;
    }
    // auto-pick po rozmiarze, jeśli podano w tekście
    if (preferredSize) {
      const pick = arr.find(x => nameHasSize(x.name, preferredSize));
      if (pick) { selected.push(pick); continue; }
    }
    // brak rozmiaru → pytamy
    clarifications.push({
      restaurant_id: arr[0].restaurant_id,
      restaurant_name: arr[0].restaurant_name,
      base: baseDishKey(arr[0].name),
      options: arr.map(x => ({ id: x.menuItemId, name: x.name, price: x.price }))
    });
  }
  return { selected, clarifications };
}

// Re-export fuzzyIncludes from helpers
export function fuzzyIncludes(name, text) {
  return fuzzyIncludesHelper(name, text);
}

const NAME_ALIASES = {
  // Zupy
  'czosnkowa': 'zupa czosnkowa',
  'czosnkowe': 'zupa czosnkowa',
  'czosnkowej': 'zupa czosnkowa',
  'zurek': 'żurek śląski',
  'zurku': 'żurek śląski',
  'zurkiem': 'żurek śląski',
  'pho': 'zupa pho bo',

  // Pizza
  'margherita': 'pizza margherita',
  'margherite': 'pizza margherita',
  'margerita': 'pizza margherita',  // częsty błąd STT
  'margarita': 'pizza margherita',  // częsty błąd STT
  'pepperoni': 'pizza pepperoni',
  'hawajska': 'pizza hawajska',
  'hawajskiej': 'pizza hawajska',
  'diavola': 'pizza diavola',
  'capricciosa': 'pizza capricciosa',

  // Mięsa
  'schabowy': 'kotlet schabowy',
  'schabowe': 'kotlet schabowy',
  'schabowego': 'kotlet schabowy',
  'kotlet': 'kotlet schabowy',
  'kotleta': 'kotlet schabowy',
  'gulasz': 'gulasz wieprzowy',
  'gulasza': 'gulasz wieprzowy',
  'gulaszem': 'gulasz wieprzowy',
  'rolada': 'rolada śląska',
  'rolade': 'rolada śląska',
  'rolady': 'rolada śląska',

  // Pierogi
  'pierogi': 'pierogi z mięsem',
  'pierogów': 'pierogi z mięsem',
  'pierogami': 'pierogi z mięsem',

  // Włoskie
  'lasagne': 'lasagne bolognese',
  'lasania': 'lasagne bolognese',  // częsty błąd STT
  'lasanie': 'lasagne bolognese',
  'tiramisu': 'tiramisu',
  'caprese': 'sałatka caprese',

  // Azjatyckie
  'pad thai': 'pad thai z krewetkami',
  'pad taj': 'pad thai z krewetkami',  // częsty błąd STT
  'padthai': 'pad thai z krewetkami',
  'sajgonki': 'sajgonki z mięsem',
  'sajgonek': 'sajgonki z mięsem',
  'sajgonkami': 'sajgonki z mięsem',

  // Inne
  'burger': 'burger',
  'burgera': 'burger',
  'placki': 'placki ziemniaczane',
  'placków': 'placki ziemniaczane',
  'frytki': 'frytki belgijskie',
  'frytek': 'frytki belgijskie',
};

export function applyAliases(text) {
  if (!text) return '';
  let t = normalizeTxt(text);
  for (const [k,v] of Object.entries(NAME_ALIASES)) {
    if (t.includes(k) && !t.includes(v)) {
      t += ' ' + v;
    }
  }
  return t;
}

function fuzzyMatch(a, b) {
  if (!a || !b) return false;
  a = normalize(a);
  b = normalize(b);
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  const dist = levenshteinHelper(a, b);
  return dist <= 2;
}

// ——— Menu catalog & order parsing ———
async function loadMenuCatalog(session) {
  // preferuj ostatnią restaurację z kontekstu, jeśli jest
  const lastId = session?.lastRestaurant?.id || session?.restaurant?.id;

  try {
    let query = supabase
      .from('menu_items')
      .select('id,name,price,restaurant_id')
      .limit(500); // lekko, ale wystarczy

    if (lastId) {
      query = query.eq('restaurant_id', lastId);
      console.log(`[intent-router] Loading menu for restaurant: ${lastId}`);
    } else {
      console.log(`[intent-router] Loading all menu items (no restaurant in session)`);
    }

    const { data: menuItems, error: menuError } = await query;
    if (menuError) {
      console.error('[intent-router] menu load error', menuError);
      return [];
    }

    if (!menuItems?.length) {
      console.warn('[intent-router] No menu items found');
      return [];
    }

    // Pobierz nazwy restauracji
    const restaurantIds = [...new Set(menuItems.map(mi => mi.restaurant_id))];
    const { data: restaurants, error: restError } = await supabase
      .from('restaurants')
      .select('id,name')
      .in('id', restaurantIds);

    if (restError) {
      console.error('[intent-router] restaurants load error', restError);
      return [];
    }

    const restaurantMap = {};
    restaurants?.forEach(r => {
      restaurantMap[r.id] = r.name;
    });

    const catalog = menuItems.map(mi => ({
      id: mi.id,
      name: mi.name,
      price: mi.price,
      restaurant_id: mi.restaurant_id,
      restaurant_name: restaurantMap[mi.restaurant_id] || 'Unknown'
    }));

    console.log(`[intent-router] Loaded ${catalog.length} menu items from ${restaurantIds.length} restaurants`);
    return catalog;
  } catch (err) {
    console.error('[intent-router] loadMenuCatalog error:', err);
    return [];
  }
}

function extractRequestedItems(text) {
  // Wyodrębnij żądane pozycje z tekstu (proste rozpoznawanie po aliasach i nazwach)
  const normalized = normalizeTxt(text);
  const requestedSet = new Set();
  
  // Sprawdź aliasy
  for (const [alias, fullName] of Object.entries(NAME_ALIASES)) {
    if (normalized.includes(alias)) {
      requestedSet.add(fullName);
    }
  }
  
  return Array.from(requestedSet).map(name => ({ name }));
}

// Rozpoznaj wiele dań w jednym tekście (split by "i", "oraz", ",")
function splitMultipleItems(text) {
  // Usuń słowa kluczowe zamówienia
  let cleaned = text
    .replace(/\b(zamów|zamówić|poproszę|chcę|wezmę|chciałbym|chciałabym)\b/gi, '')
    .trim();

  // Split by separators
  const parts = cleaned.split(/\s+(i|oraz|,)\s+/i).filter(p => p && !['i', 'oraz', ','].includes(p.toLowerCase()));

  // Jeśli nie ma separatorów, zwróć cały tekst
  if (parts.length <= 1) {
    return [text];
  }

  return parts;
}

export function parseOrderItems(text, catalog) {
  // Null checks
  if (!text || typeof text !== 'string') {
    console.warn('[parseOrderItems] Invalid text input:', text);
    return {
      any: false,
      groups: [],
      clarify: [],
      available: [],
      unavailable: [],
      needsClarification: false,
      missingAll: true
    };
  }

  const textAliased = applyAliases(text);
  const preferredSize = extractSize(textAliased);
  const requestedItems = extractRequestedItems(text);

  // Obsługa pustego menu lub braku katalogu
  if (!catalog || !Array.isArray(catalog) || catalog.length === 0) {
    console.warn('[parseOrderItems] Invalid or empty catalog:', catalog);
    return {
      any: false,
      groups: [],
      clarify: [],
      available: [],
      unavailable: requestedItems || [],
      needsClarification: false,
      missingAll: true
    };
  }

  // Multi-item parsing: split text by "i", "oraz", ","
  const itemTexts = splitMultipleItems(textAliased);
  const allHits = [];

  for (const itemText of itemTexts) {
    if (!itemText || typeof itemText !== 'string') continue;

    const qty = extractQuantity(itemText);
    const hits = catalog
      .filter(it => it && it.name && fuzzyIncludes(it.name, itemText))
      .map(it => ({
        menuItemId: it.id || null,
        name: it.name || 'Unknown',
        price: it.price || 0,
        quantity: qty || 1,
        restaurant_id: it.restaurant_id || null,
        restaurant_name: it.restaurant_name || 'Unknown',
        matchScore: 1.0
      }));
    allHits.push(...hits);
  }

  const { selected, clarifications } = dedupHitsByBase(allHits, preferredSize);

  // Sprawdź czy są niedostępne pozycje (fallback)
  const matched = (selected || []).filter(h => h && h.matchScore > 0.75);
  const requestedNames = (requestedItems || []).map(i => i && i.name ? i.name.toLowerCase() : '').filter(Boolean);
  const availableNames = matched.map(m => m && m.name ? m.name.toLowerCase() : '').filter(Boolean);
  const unavailableNames = requestedNames.filter(n => !availableNames.includes(n));

  const byR = {};
  for (const h of matched) {
    byR[h.restaurant_id] ??= { restaurant_id: h.restaurant_id, restaurant_name: h.restaurant_name, items: [] };
    byR[h.restaurant_id].items.push({
      menuItemId: h.menuItemId, name: h.name, price: h.price, quantity: h.quantity
    });
  }

  return {
    any: allHits.length > 0,
    groups: Object.values(byR),
    clarify: clarifications,
    available: matched,
    unavailable: unavailableNames,
    needsClarification: unavailableNames.length > 0 || (clarifications && clarifications.length > 0)
  };
}

export async function detectIntent(text, session = null) {
  console.log('[intent-router] 🚀 detectIntent called with:', { text, sessionId: session?.id });
  
  if (!text) {
    updateDebugSession({ intent: 'none', restaurant: null, sessionId: session?.id || null });
    return { intent: 'none', restaurant: null };
  }

  try {
    // --- Korekta STT / lokalizacji ---
    let normalizedText = text.toLowerCase()
      .replace(/\bsokolica\b/g, "okolicy") // typowa halucynacja STT
      .replace(/\bw\s*okolice\b/g, "w okolicy") // brak spacji itp.
      .replace(/\bw\s*okolicach\b/g, "w okolicy")
      .replace(/\bpizzeriach\b/g, "pizzerie") // dopasowanie intencji
      .trim();

    const lower = normalizeTxt(normalizedText);

    // ——— CONFIRM FLOW V2 (with modify) ———
    const confirmYes = [
      "tak", "potwierdzam", "zamawiam", "poproszę", "oczywiście", "jasne", "dobrze"
    ];
    const confirmNo = [
      "nie", "rezygnuję", "anuluj", "poczekaj", "nie teraz", "nie zamawiaj"
    ];
    const confirmModify = [
      "coś innego", "inne", "zmień", "chciałbym coś innego", "inny zestaw"
    ];

    // Sprawdź confirm flow tylko jeśli jest oczekujące zamówienie
    if (session?.lastPendingOrder) {
      if (confirmYes.some(p => lower.includes(p))) {
        const order = session.lastPendingOrder;
        delete session.lastPendingOrder;
        updateDebugSession({ 
          intent: "confirm_yes", 
          restaurant: order?.restaurant_name || null,
          sessionId: session?.id || null,
          confidence: 1.0
        });
        return {
          intent: "confirm_yes",
          order: order,
          reply: `Świetnie! Zamówienie potwierdzone: ${order.items?.map(i => i.name).join(", ")}`,
          confidence: 1.0
        };
      }
      if (confirmNo.some(p => lower.includes(p))) {
        delete session.lastPendingOrder;
        updateDebugSession({ 
          intent: "confirm_no", 
          restaurant: null,
          sessionId: session?.id || null,
          confidence: 1.0
        });
        return {
          intent: "confirm_no",
          reply: "Okej, rezygnuję z zamówienia. Mogę Ci jeszcze w czymś pomóc?",
          confidence: 1.0
        };
      }
      if (confirmModify.some(p => lower.includes(p))) {
        const oldOrder = session.lastPendingOrder;
        delete session.lastPendingOrder;
        updateDebugSession({ 
          intent: "modify_order", 
          restaurant: oldOrder?.restaurant_name || null,
          sessionId: session?.id || null,
          confidence: 1.0
        });
        return {
          intent: "modify_order",
          oldOrder: oldOrder,
          reply: `Okej, zmieniam zamówienie. Co zamiast ${oldOrder.items?.map(i => i.name).join(", ")}?`,
          confidence: 1.0
        };
      }
    }

    // ——— EARLY DISH DETECTION (PRIORITY 1) ———
    console.log('[intent-router] 🔍 Starting early dish detection for text:', text);
    console.log('[intent-router] 🔍 Normalized text:', normalizedText);
    
    // 🔹 KROK 1: Sprawdź czy w tekście jest nazwa restauracji
    // Jeśli tak, załaduj menu z tej restauracji (nie z session)
    let targetRestaurant = null;
    
    try {
      const { data: restaurantsList } = await supabase
        .from('restaurants')
        .select('id, name');

      if (restaurantsList?.length) {
        console.log(`[intent-router] 🔍 Checking ${restaurantsList.length} restaurants for fuzzy match`);
        for (const r of restaurantsList) {
          const normalizedName = normalizeTxt(r.name);
          console.log(`[intent-router] 🔍 Checking restaurant: ${r.name} -> ${normalizedName}`);

          // Exact match
          if (normalizedText.includes(normalizedName)) {
            targetRestaurant = r;
            console.log(`[intent-router] 🏪 Restaurant detected in text (exact): ${r.name}`);
            break;
          }

          // Fuzzy match: sprawdź czy słowa z nazwy są w tekście (z Levenshtein distance)
          const nameWords = normalizedName.split(' ');
          const textWords = normalizedText.split(' ');
          let matchedWords = 0;
          console.log(`[intent-router] 🔍 Fuzzy match - name words: [${nameWords.join(', ')}], text words: [${textWords.join(', ')}]`);

          for (const nameWord of nameWords) {
            for (const textWord of textWords) {
              const dist = levenshteinHelper(textWord, nameWord);
              console.log(`[intent-router] 🔍 Comparing: "${textWord}" vs "${nameWord}" distance: ${dist}`);
              if (textWord === nameWord || dist <= 1) {
                matchedWords++;
                console.log(`[intent-router] ✅ Word match! Total: ${matchedWords}/${nameWords.length}`);
                break;
              }
            }
          }

          const threshold = Math.ceil(nameWords.length / 2);
          console.log(`[intent-router] 🔍 Matched: ${matchedWords}/${nameWords.length}, threshold: ${threshold}`);
          
          if (matchedWords >= threshold) {
            targetRestaurant = r;
            console.log(`[intent-router] 🏪 Restaurant detected in text (fuzzy): ${r.name} (matched: ${matchedWords}/${nameWords.length})`);
            console.log(`[intent-router] 🏪 targetRestaurant set to:`, targetRestaurant);
            break;
          }
        }
      } else {
        console.log(`[intent-router] ❌ No restaurants found in database`);
      }

      // 🔹 KROK 2: Załaduj katalog menu
      // Jeśli znaleziono restaurację w tekście, użyj jej
      // W przeciwnym razie użyj session
      const sessionWithRestaurant = targetRestaurant
        ? { lastRestaurant: targetRestaurant }
        : session;

      const catalog = await loadMenuCatalog(sessionWithRestaurant);
      console.log(`[intent-router] Catalog loaded: ${catalog.length} items`);

      if (catalog.length) {
        console.log('[intent-router] 🔍 Calling parseOrderItems...');
        const parsed = parseOrderItems(normalizedText, catalog);
        console.log(`[intent-router] Parsed result:`, parsed);

        // Obsługa pustego menu
        if (parsed.missingAll) {
          console.log('⚠️ No menu items found in catalog');
          updateDebugSession({ 
            intent: 'no_menu_items', 
            restaurant: null,
            sessionId: session?.id || null,
            confidence: 0.8
          });
          return {
            intent: 'no_menu_items',
            reply: 'Nie znalazłam żadnych pozycji w menu tej restauracji. Może chcesz sprawdzić coś innego?',
            confidence: 0.8,
            fallback: true
          };
        }

        // Sprawdź czy są niedostępne pozycje (nawet jeśli parsed.any === false)
        // ⚠️ ALE: jeśli tekst zawiera nazwę restauracji, to nie zwracaj clarify_order
        // (user może mówić np. "klaps burger" = nazwa restauracji, a nie zamówienie)
        if (parsed.unavailable && parsed.unavailable.length > 0 && parsed.needsClarification) {
          const missing = parsed.unavailable.join(', ');
          const restaurantName = session?.lastRestaurant?.name || 'tym menu';
          console.log(`⚠️ Unavailable items detected: ${missing} in ${restaurantName}`);
          
          // Sprawdź czy tekst zawiera nazwę restauracji (może to być nazwa restauracji, a nie zamówienie)
          let containsRestaurantName = false;
          const { data: restaurantsCheck } = await supabase
            .from('restaurants')
            .select('id, name');
          
          console.log(`🔍 Checking if text contains restaurant name: "${normalizedText}"`);
          
          if (restaurantsCheck?.length) {
            for (const r of restaurantsCheck) {
              const normalizedName = normalizeTxt(r.name);
              const nameWords = normalizedName.split(' ');
              const textWords = normalizedText.split(' ');
              let matchedWords = 0;

              console.log(`🔍 Checking restaurant: ${r.name} -> ${normalizedName}`);
              console.log(`🔍 Name words: [${nameWords.join(', ')}], Text words: [${textWords.join(', ')}]`);

              for (const nameWord of nameWords) {
                for (const textWord of textWords) {
                  const dist = levenshteinHelper(textWord, nameWord);
                  console.log(`🔍 Comparing: "${textWord}" vs "${nameWord}" distance: ${dist}`);
                  if (textWord === nameWord || dist <= 1) {
                    matchedWords++;
                    console.log(`✅ Word match! Total: ${matchedWords}/${nameWords.length}`);
                    break;
                  }
                }
              }

              const threshold = Math.ceil(nameWords.length / 2);
              console.log(`🔍 Matched: ${matchedWords}/${nameWords.length}, threshold: ${threshold}`);
              
              if (matchedWords >= threshold) {
                containsRestaurantName = true;
                console.log(`✅ Text contains restaurant name: ${r.name} — skipping clarify_order`);
                break;
              }
            }
          }

          // Jeśli tekst NIE zawiera nazwy restauracji, to zwróć clarify_order
          if (!containsRestaurantName) {
            updateDebugSession({ 
              intent: 'clarify_order', 
              restaurant: restaurantName,
              sessionId: session?.id || null,
              confidence: 0.9
            });
            return {
              intent: 'clarify_order',
              parsedOrder: parsed,
              reply: `Nie znalazłam aktualnie ${missing} w menu ${restaurantName}, może chciałbyś coś innego?`,
              confidence: 0.9,
              unavailable: parsed.unavailable
            };
          }
        }

        if (parsed.any) {
          console.log(`🍽️ Dish detected: ${parsed.groups.map(g => g.items.map(i => i.name).join(', ')).join(' | ')}`);
          
          updateDebugSession({ 
            intent: 'create_order', 
            restaurant: parsed.groups[0]?.restaurant_name || null,
            sessionId: session?.id || null,
            confidence: 0.85
          });
          return {
            intent: 'create_order',
            parsedOrder: parsed,   // brainRouter użyje tego bez fallbacków
            confidence: 0.85
          };
        } else {
          console.log('[intent-router] No dishes matched in catalog');
        }
      } else {
        console.log('[intent-router] Catalog is empty, skipping dish detection');
      }
    } catch (e) {
      console.error('[intent-router] dish parse error:', e);
    }

    // 🔹 KROK 3: Przygotuj słowa kluczowe (przed sprawdzeniem targetRestaurant)
    // Bazowe słowa kluczowe (BEZ polskich znaków - znormalizowane przez normalizeTxt)
    const findNearbyKeywords = [
      'zjesc', 'restaurac', 'pizza', 'kebab', 'burger', 'zjesc cos', 'gdzie',
      'w okolicy', 'blisko', 'cos do jedzenia', 'posilek', 'obiad',
      'gdzie zjem', 'co polecasz', 'restauracje w poblizu',
      'mam ochote', 'ochote na', 'chce cos', 'szukam', 'szukam czegos',
      'cos azjatyckiego', 'cos lokalnego', 'cos szybkiego',
      'dostepne', 'co jest dostepne', 'co dostepne', 'co mam w poblizu',
      'co w okolicy', 'co jest w okolicy'
    ];

    const menuKeywords = [
      'menu', 'co moge zjesc', 'co maja', 'pokaz menu', 'co jest w menu',
      'dania', 'potrawy', 'co serwuja', 'co podaja', 'karta dan'
    ];

    const orderKeywords = [
      'zamow', 'poproshe', 'chce zamowic', 'zloz zamowienie', 'zamowic cos',
      'dodaj do zamowienia', 'zloz', 'wybieram', 'biore', 'wezme'
      // Usunięto 'chce' — zbyt ogólne, koliduje z "chce cos szybkiego" (find_nearby)
    ];

    // Pobierz nauczone frazy z bazy
    const { data: learned } = await supabase
      .from('phrases')
      .select('text, intent');

    const learnedNearby = learned?.filter(p => p.intent === 'find_nearby') || [];
    const learnedMenu = learned?.filter(p => p.intent === 'menu_request') || [];
    const learnedOrder = learned?.filter(p => p.intent === 'create_order') || [];

    const dynamicNearbyKeywords = learnedNearby.map(p => normalizeTxt(p.text));
    const dynamicMenuKeywords = learnedMenu.map(p => normalizeTxt(p.text));
    const dynamicOrderKeywords = learnedOrder.map(p => normalizeTxt(p.text));

    // Deduplikacja — usuń duplikaty między bazowymi a dynamicznymi
    const allNearbyKeywords = [...new Set([...findNearbyKeywords, ...dynamicNearbyKeywords])];
    const allMenuKeywords = [...new Set([...menuKeywords, ...dynamicMenuKeywords])];
    const allOrderKeywords = [...new Set([...orderKeywords, ...dynamicOrderKeywords])];

    // 🔹 KROK 4: Jeśli w early dish detection znaleziono restaurację, ale nie znaleziono dań
    // to zwróć odpowiedni intent na podstawie słów kluczowych
    console.log(`[intent-router] 🔍 Checking targetRestaurant:`, targetRestaurant);
    if (targetRestaurant) {
      console.log(`[intent-router] 🏪 Restaurant found in early detection: ${targetRestaurant.name}, checking keywords...`);
      console.log(`[intent-router] 🔍 Lower text: "${lower}"`);
      console.log(`[intent-router] 🔍 Menu keywords:`, allMenuKeywords);
      console.log(`[intent-router] 🔍 Order keywords:`, allOrderKeywords);
      
      // Sprawdź słowa kluczowe
      if (allMenuKeywords.some(k => lower.includes(k))) {
        console.log(`[intent-router] ✅ Menu keyword found, returning menu_request`);
        updateDebugSession({ 
          intent: 'menu_request', 
          restaurant: targetRestaurant.name,
          sessionId: session?.id || null,
          confidence: 0.9
        });
        return { intent: 'menu_request', restaurant: targetRestaurant };
      }
      
      if (allOrderKeywords.some(k => lower.includes(k))) {
        console.log(`[intent-router] ✅ Order keyword found, returning create_order`);
        updateDebugSession({ 
          intent: 'create_order', 
          restaurant: targetRestaurant.name,
          sessionId: session?.id || null,
          confidence: 0.9
        });
        return { intent: 'create_order', restaurant: targetRestaurant };
      }
      
      // W przeciwnym razie → select_restaurant
      console.log(`[intent-router] ✅ No specific keywords, returning select_restaurant`);
      updateDebugSession({ 
        intent: 'select_restaurant', 
        restaurant: targetRestaurant.name,
        sessionId: session?.id || null,
        confidence: 0.9
      });
      return { intent: 'select_restaurant', restaurant: targetRestaurant };
    } else {
      console.log(`[intent-router] ❌ No targetRestaurant found, continuing to keyword detection`);
    }

    // Słowa kluczowe już zdefiniowane wcześniej

    // 🔹 PRIORYTET 0: Sprawdź czy w tekście jest ilość (2x, 3x, "dwa razy", etc.)
    // Jeśli tak, to najprawdopodobniej user chce zamówić, nie wybierać restauracji
    const quantityPattern = /(\d+\s*x|\d+\s+razy|dwa\s+razy|trzy\s+razy|kilka)/i;
    if (quantityPattern.test(text)) {
      console.log('🔢 Quantity detected → create_order');
      return { intent: 'create_order', restaurant: null };
    }

    // 🔹 PRIORYTET 1: Sprawdź czy w tekście jest nazwa restauracji (fuzzy matching)
    // Jeśli tak, to najprawdopodobniej user chce wybrać restaurację lub zobaczyć menu
    console.log('🔍 PRIORYTET 1: Sprawdzam restauracje w tekście:', text);
    const { data: restaurantsList } = await supabase
      .from('restaurants')
      .select('id, name');
    
    console.log('🔍 Znaleziono restauracji:', restaurantsList?.length || 0);

    if (restaurantsList?.length) {
      const normalizedText = normalizeTxt(text);
      console.log('🔍 Normalizowany tekst:', normalizedText);
      for (const r of restaurantsList) {
        const normalizedName = normalizeTxt(r.name);
        console.log('🔍 Sprawdzam restaurację:', r.name, '->', normalizedName);

        // Sprawdź czy nazwa restauracji jest w tekście (fuzzy match)
        // 1. Exact substring match
        if (normalizedText.includes(normalizedName)) {
          console.log('✅ Exact match found:', r.name);
          // Jeśli jest "menu" → menu_request
          if (allMenuKeywords.some(k => lower.includes(k))) {
            return { intent: 'menu_request', restaurant: r };
          }
          // Jeśli jest "zamów"/"wybieram" → create_order
          if (allOrderKeywords.some(k => lower.includes(k))) {
            return { intent: 'create_order', restaurant: r };
          }
          // W przeciwnym razie → select_restaurant
          return { intent: 'select_restaurant', restaurant: r };
        }

        // 2. Fuzzy match — sprawdź czy słowa z nazwy restauracji są w tekście
        const nameWords = normalizedName.split(' ');
        const textWords = normalizedText.split(' ');
        let matchedWords = 0;
        console.log('🔍 Fuzzy match - name words:', nameWords, 'text words:', textWords);

        for (const nameWord of nameWords) {
          for (const textWord of textWords) {
            const dist = levenshteinHelper(textWord, nameWord);
            console.log('🔍 Comparing:', textWord, 'vs', nameWord, 'distance:', dist);
            if (textWord === nameWord || dist <= 1) {
              matchedWords++;
              console.log('✅ Word match!');
              break;
            }
          }
        }

        console.log('🔍 Matched words:', matchedWords, 'out of', nameWords.length, 'threshold:', Math.ceil(nameWords.length / 2));
        // Jeśli ≥50% słów z nazwy restauracji pasuje → uznaj za match
        if (matchedWords >= Math.ceil(nameWords.length / 2)) {
          console.log('✅ Fuzzy match found:', r.name);
          // Jeśli jest "menu" → menu_request
          if (allMenuKeywords.some(k => lower.includes(k))) {
            updateDebugSession({ 
              intent: 'menu_request', 
              restaurant: r.name,
              sessionId: session?.id || null,
              confidence: 0.9
            });
            return { intent: 'menu_request', restaurant: r };
          }
          // Jeśli jest "zamów"/"wybieram" → create_order
          if (allOrderKeywords.some(k => lower.includes(k))) {
            updateDebugSession({ 
              intent: 'create_order', 
              restaurant: r.name,
              sessionId: session?.id || null,
              confidence: 0.9
            });
            return { intent: 'create_order', restaurant: r };
          }
          // W przeciwnym razie → select_restaurant
          updateDebugSession({ 
            intent: 'select_restaurant', 
            restaurant: r.name,
            sessionId: session?.id || null,
            confidence: 0.9
          });
          return { intent: 'select_restaurant', restaurant: r };
        }
      }
    }

    // 🔹 PRIORYTET 2: Sprawdź menu keywords (bardziej specyficzne niż order)
    if (allMenuKeywords.some(k => lower.includes(k))) {
      updateDebugSession({ 
        intent: 'menu_request', 
        restaurant: null,
        sessionId: session?.id || null,
        confidence: 0.8
      });
      return { intent: 'menu_request', restaurant: null };
    }

    // 🔹 PRIORYTET 3: Sprawdź order keywords
    if (allOrderKeywords.some(k => lower.includes(k))) {
      updateDebugSession({ 
        intent: 'create_order', 
        restaurant: null,
        sessionId: session?.id || null,
        confidence: 0.8
      });
      return { intent: 'create_order', restaurant: null };
    }

    // 🔹 PRIORYTET 4: Sprawdź nearby keywords
    console.log('[intent-router] Checking nearby keywords...');
    console.log('[intent-router] Text:', text);
    console.log('[intent-router] Normalized:', lower);
    console.log('[intent-router] All nearby keywords:', allNearbyKeywords);
    
    const matchingKeywords = allNearbyKeywords.filter(k => lower.includes(k));
    console.log('[intent-router] Matching keywords:', matchingKeywords);
    
    if (matchingKeywords.length > 0) {
      console.log('[intent-router] ✅ Found nearby intent!');
      updateDebugSession({ 
        intent: 'find_nearby', 
        restaurant: null,
        sessionId: session?.id || null,
        confidence: 0.8
      });
      return { intent: 'find_nearby', restaurant: null };
    }

    // Jeśli Amber nie zna frazy — zapisuje ją do bazy do przyszłego uczenia
    try {
      await supabase.from('phrases').insert({ text: text, intent: 'none' });
    } catch (err) {
      console.warn('⚠️ Phrase insert skipped:', err.message);
    }

    updateDebugSession({ 
      intent: 'none', 
      restaurant: null,
      sessionId: session?.id || null,
      confidence: 0.0
    });
    return { intent: 'none', restaurant: null };
  } catch (err) {
    console.error('🧠 detectIntent error:', err.message);
    updateDebugSession({ 
      intent: 'error', 
      restaurant: null,
      sessionId: session?.id || null,
      confidence: 0.0
    });
    return { intent: 'none', restaurant: null };
  }
}

export async function handleIntent(intent, text, session) {
  try {
    switch (intent) {
      case "select_restaurant": {
        // Ten case jest obsługiwany w brainRouter.js
        return { reply: "Restauracja wybrana, przechodzę do brainRouter..." };
      }

      case "create_order": {
        const restaurant = session?.lastRestaurant;
        if (!restaurant) {
          return { reply: "Najpierw wybierz restaurację, zanim złożysz zamówienie." };
        }

        try {
          const order = await createOrder(restaurant.id, session?.userId || "guest");
          return {
            reply: `Zamówienie utworzone w ${restaurant.name}. Numer: ${order?.id || "brak danych"}.`,
            order,
          };
        } catch (err) {
          console.error("⚠️ createOrder error:", err.message);
          return { reply: "Nie udało się utworzyć zamówienia. Spróbuj ponownie." };
        }
      }

      case "menu_request": {
        const restaurant = session?.lastRestaurant;
        if (!restaurant) {
          return { reply: "Najpierw wybierz restaurację, żebym mogła pobrać menu." };
        }

        try {
          const { data: menu, error } = await supabase
            .from("menu_items")
            .select("name, price")
            .eq("restaurant_id", restaurant.id)
            .limit(6);

          if (error) {
            console.error("⚠️ Supabase error in menu_request:", error?.message || "Brak danych");
            return {
              ok: false,
              intent: "menu_request",
              restaurant,
              reply: "Nie mogę pobrać danych z bazy. Sprawdź połączenie z serwerem.",
            };
          }

          if (!menu?.length) {
            return { reply: `W bazie nie ma pozycji menu dla ${restaurant.name}.` };
          }

          return {
            reply: `W ${restaurant.name} dostępne: ${menu
              .map((m) => `${m.name} (${Number(m.price).toFixed(2)} zł)`)
              .join(", ")}.`,
          };
        } catch (err) {
          console.error("⚠️ menu_request error:", err.message);
          return { reply: "Nie mogę pobrać menu. Sprawdź połączenie z bazą." };
        }
      }

      case "find_nearby": {
        try {
          const { data, error } = await supabase
            .from("restaurants")
            .select("name, address, city")
            .limit(5);

          if (error) {
            console.error("⚠️ Supabase error in find_nearby:", error?.message || "Brak danych");
            return {
              ok: false,
              intent: "find_nearby",
              restaurant: null,
              reply: "Nie mogę pobrać danych z bazy. Sprawdź połączenie z serwerem.",
            };
          }

          if (!data?.length) {
            return { reply: "Nie znalazłam restauracji w pobliżu." };
          }

          return {
            reply:
              "W pobliżu możesz zjeść w: " +
              data.map((r) => `${r.name} (${r.city || r.address})`).join(", "),
          };
        } catch (err) {
          console.error("⚠️ find_nearby error:", err.message);
          return { reply: "Nie mogę pobrać listy restauracji. Sprawdź połączenie." };
        }
      }

      case "none":
        return { reply: "Nie jestem pewna, co masz na myśli — spróbuj inaczej." };

      default:
        console.warn(`⚠️ Unknown intent: ${intent}`);
        return { reply: "Nie jestem pewna, co masz na myśli — spróbuj inaczej." };
    }
  } catch (err) {
    console.error("🧠 handleIntent error:", err.message);
    return { reply: "Wystąpił błąd podczas przetwarzania. Spróbuj ponownie." };
  }
}

export async function trainIntent(phrase, correctIntent) {
  try {
    const normalized = normalizeTxt(phrase);
    const { data: existing, error } = await supabase
      .from('phrases')
      .select('id, text, intent');

    if (error) {
      console.error('⚠️ trainIntent fetch error:', error.message);
      return { ok: false, error: error.message };
    }

    const already = existing?.find(p => fuzzyMatch(normalized, p.text));
    if (already) {
      const { error: updateError } = await supabase
        .from('phrases')
        .update({ intent: correctIntent })
        .eq('id', already.id);

      if (updateError) {
        console.error('⚠️ trainIntent update error:', updateError.message);
        return { ok: false, error: updateError.message };
      }

      console.log(`✅ Updated phrase "${phrase}" → ${correctIntent}`);
      return { ok: true, action: 'updated' };
    } else {
      const { error: insertError } = await supabase
        .from('phrases')
        .insert({ text: phrase, intent: correctIntent });

      if (insertError) {
        console.error('⚠️ trainIntent insert error:', insertError.message);
        return { ok: false, error: insertError.message };
      }

      console.log(`✅ Inserted phrase "${phrase}" → ${correctIntent}`);
      return { ok: true, action: 'inserted' };
    }
  } catch (err) {
    console.error('🧠 trainIntent error:', err.message);
    return { ok: false, error: err.message };
  }
}