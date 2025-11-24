import { supabase } from "../../_supabase.js";
import { normalize } from "../utils/normalizeText.js";

export function normalizeDishText(text) {
  return normalize(text);
}

export function levenshtein(a, b) {
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

export function fuzzyMatch(a, b, threshold = 3) {
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

export async function parseOrderItems(text, restaurantId) {
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
