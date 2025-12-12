import { supabase } from "../../_supabase.js";
// Using local safe normalization instead of the destructive global util
// import { normalize } from "../utils/normalizeText.js";

// FAZA 2 — Alias map (deterministyczne)
const ALIAS_MAP = {
  "cola": "coca-cola",
  "pepsi": "pepsi",
  "frytki": "fries"
};

function normalize(text) {
  if (!text) return "";
  let s = text.toLowerCase();
  // Basic Polish declension normalization (Accusative/Instrumental -> Nominative approximation)
  s = s.replace(/ę\b/g, 'a'); // pizzę -> pizza
  s = s.replace(/ą\b/g, 'a'); // pizzą -> pizza

  // Safe cleanup
  s = s.replace(/[^a-ząćęłńóśźż0-9\s]/g, ''); // remove punctuation
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

export function normalizeDishText(text) {
  return normalize(text);
}

// Removed aggressive Levenshtein logic to stabilize Intent Detection

export function parseRestaurantAndDish(text) {
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

export function extractQuantity(text) {
  const normalized = text.toLowerCase();

  // FAZA 1 — Twarde tokeny (liczby, ilości)
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
    // Word boundary check to avoid partial matches inside other words
    const regex = new RegExp(`\\b${word}\\b`, 'i');
    if (regex.test(normalized)) {
      return qty;
    }
  }

  return 1; // Domyślnie 1
}

export async function findDishInMenu(restaurantId, dishName) {
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

    // FAZA 1: Exact match (Twarde tokeny - znane produkty)
    let matched = menu.find(item => normalize(item.name) === normalizedDish);
    if (matched) {
      console.log(`✅ Exact match (Phase 1): "${dishName}" → ${matched.name}`);
      return matched;
    }

    // FAZA 2: Alias Map
    for (const [alias, realName] of Object.entries(ALIAS_MAP)) {
      if (normalizedDish.includes(alias) || alias === normalizedDish) {
        matched = menu.find(item => normalize(item.name) === normalize(realName));
        if (matched) {
          console.log(`✅ Alias match (Phase 2): "${dishName}" matches alias "${alias}" → ${matched.name}`);
          return matched;
        }
      }
    }

    // Substring match as a safer fallback than fuzzy (still Phase 1-ish logic)
    matched = menu.find(item => {
      const normName = normalize(item.name);
      return normName.includes(normalizedDish) || normalizedDish.includes(normName);
    });
    if (matched) {
      console.log(`✅ Substring match: "${dishName}" → ${matched.name}`);
      return matched;
    }

    console.warn(`⚠️ No match for dish: "${dishName}"`);
    return null; // Don't return unknown_item here as this function expects a DB record or null
  } catch (err) {
    console.error('❌ findDishInMenu error:', err);
    return null;
  }
}

export async function parseOrderItems(text, restaurantId) {
  if (!text || !restaurantId) return [];

  try {
    console.log(`🛒 Parsing order items from: "${text}" with 2-Phase Parsing`);

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
    const quantity = extractQuantity(text);

    // FAZA 1 — Twarde tokeny (znane produkty z menu)
    // Sprawdź czy nazwa dania z menu występuje w tekście
    for (const menuItem of menu) {
      const dishName = normalize(menuItem.name);

      // Strict inclusion check instead of fuzzy
      if (normalized.includes(dishName)) {
        items.push({
          id: menuItem.id,
          name: menuItem.name,
          price: parseFloat(menuItem.price_pln),
          quantity: quantity
        });
        console.log(`✅ Found dish (Phase 1): ${menuItem.name} (qty: ${quantity})`);
      }
    }

    // FAZA 2 — Alias map
    if (items.length === 0) {
      for (const [alias, realName] of Object.entries(ALIAS_MAP)) {
        // Use word boundary for aliases to avoid "s" matching "sand" etc. if alias is short
        // But for "cola" vs "coca-cola", simple include might be okay, but regex is safer.
        if (normalized.includes(alias)) {
          const targetItem = menu.find(m => normalize(m.name).includes(normalize(realName)) || normalize(realName).includes(normalize(m.name)));
          if (targetItem) {
            // Check if already added to avoid duplicates if Phase 1 somehow missed it but Phase 2 caught it
            // (Though we only enter here if items.length === 0, or we can allow multiple)
            if (!items.find(i => i.id === targetItem.id)) {
              items.push({
                id: targetItem.id,
                name: targetItem.name,
                price: parseFloat(targetItem.price_pln),
                quantity: quantity
              });
              console.log(`✅ Found dish via Alias (Phase 2): "${alias}" → ${targetItem.name}`);
            }
          }
        }
      }
    }

    // Jeśli znaleziono, zwróć
    if (items.length > 0) {
      console.log(`🛒 Parsed ${items.length} items:`, items);
      return items;
    }

    // Fallback logic -> Try to extract generic dish name
    const parsed = parseRestaurantAndDish(text);
    if (parsed.dish) {
      // One last checks against menu using findDishInMenu (which also uses alias now)
      const matched = await findDishInMenu(restaurantId, parsed.dish);
      if (matched) {
        items.push({
          id: matched.id,
          name: matched.name,
          price: parseFloat(matched.price_pln),
          quantity: quantity
        });
        return items;
      } else {
        // NIE FAILUJ -> Zwróć unknown_item
        console.log(`⚠️ Parsed dish "${parsed.dish}" but not found in menu. Returning unknown_item.`);
        return [{
          id: 'unknown_item',
          name: parsed.dish, // extracted text
          price: 0,
          quantity: quantity,
          isUnknown: true
        }];
      }
    }

    return [];
  } catch (err) {
    console.error('❌ parseOrderItems error:', err);
    return [];
  }
}

