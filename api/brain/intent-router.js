import { supabase } from '../_supabase.js';
import { createOrder } from '../orders.js';

function normalize(text) {
  return text.toLowerCase().replace(/[^a-ząćęłńóśźż0-9 ]/g, '').trim();
}

function fuzzyMatch(a, b) {
  if (!a || !b) return false;
  a = normalize(a);
  b = normalize(b);
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  const dist = levenshtein(a, b);
  return dist <= 2;
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

export async function detectIntent(text) {
  if (!text) return { intent: 'none', restaurant: null };

  // --- Korekta STT / lokalizacji ---
  let normalizedText = text.toLowerCase()
    .replace(/\bsokolica\b/g, "okolicy") // typowa halucynacja STT
    .replace(/\bw\s*okolice\b/g, "w okolicy") // brak spacji itp.
    .replace(/\bw\s*okolicach\b/g, "w okolicy")
    .replace(/\bpizzeriach\b/g, "pizzerie") // dopasowanie intencji
    .trim();

  const lower = normalize(normalizedText);
  const { data: restaurants } = await supabase
    .from('restaurants')
    .select('id, name, address, lat, lng');

  // Rozluźnienie dopasowań - usuń "w " z początku
  const cleanText = lower.replace(/^w\s+/, '').trim();
  const matched = restaurants?.find(r => fuzzyMatch(cleanText, r.name));
  if (matched) {
    return { intent: 'select_restaurant', restaurant: matched };
  }

  const findNearbyKeywords = [
    'zjeść', 'restaurac', 'pizza', 'kebab', 'burger', 'zjeść coś', 'gdzie',
    'w okolicy', 'blisko', 'zamówić', 'coś do jedzenia', 'posiłek', 'obiad',
    'gdzie zjem', 'co polecasz', 'restauracje w pobliżu', 'restauracje w poblizu'
  ];

  const menuKeywords = [
    'menu', 'co mogę zjeść', 'co mają', 'pokaż menu', 'co jest w menu',
    'dania', 'potrawy', 'co serwują', 'co podają', 'karta dań'
  ];

  const orderKeywords = [
    'zamów', 'poproszę', 'chcę zamówić', 'złóż zamówienie', 'zamówić coś',
    'dodaj do zamówienia', 'złóż', 'zamówić'
  ];

  const { data: learned } = await supabase
    .from('phrases')
    .select('text, intent');

  const learnedNearby = learned?.filter(p => p.intent === 'find_nearby') || [];
  const learnedMenu = learned?.filter(p => p.intent === 'menu_request') || [];
  const learnedOrder = learned?.filter(p => p.intent === 'create_order') || [];
  
  const dynamicNearbyKeywords = learnedNearby.map(p => normalize(p.text));
  const dynamicMenuKeywords = learnedMenu.map(p => normalize(p.text));
  const dynamicOrderKeywords = learnedOrder.map(p => normalize(p.text));
  
  const allNearbyKeywords = [...findNearbyKeywords, ...dynamicNearbyKeywords];
  const allMenuKeywords = [...menuKeywords, ...dynamicMenuKeywords];
  const allOrderKeywords = [...orderKeywords, ...dynamicOrderKeywords];

  // Sprawdź order keywords
  if (allOrderKeywords.some(k => lower.includes(k))) {
    return { intent: 'create_order', restaurant: null };
  }

  // Sprawdź menu keywords
  if (allMenuKeywords.some(k => lower.includes(k))) {
    return { intent: 'menu_request', restaurant: null };
  }

  // Sprawdź nearby keywords
  if (allNearbyKeywords.some(k => lower.includes(k))) {
    return { intent: 'find_nearby', restaurant: null };
  }

  // Jeśli Amber nie zna frazy — zapisuje ją do bazy do przyszłego uczenia
  try {
    await supabase.from('phrases').insert({ text: text, intent: 'none' });
  } catch (err) {
    console.warn('Phrase insert skipped:', err.message);
  }

  return { intent: 'none', restaurant: null };
}

export async function handleIntent(intent, text, session) {
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

      const order = await createOrder(restaurant.id, session?.userId || "guest");
      return {
        reply: `Zamówienie utworzone w ${restaurant.name}. Numer: ${order?.id || "brak danych"}.`,
        order,
      };
    }

    case "menu_request": {
      const restaurant = session?.lastRestaurant;
      if (!restaurant) {
        return { reply: "Najpierw wybierz restaurację, żebym mogła pobrać menu." };
      }

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
    }

    case "find_nearby": {
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
    }

    default:
      return { reply: "Nie jestem pewna, co masz na myśli — spróbuj inaczej." };
  }
}

export async function trainIntent(phrase, correctIntent) {
  const normalized = normalize(phrase);
  const { data: existing } = await supabase
    .from('phrases')
    .select('id, text, intent');

  const already = existing?.find(p => fuzzyMatch(normalized, p.text));
  if (already) {
    await supabase.from('phrases').update({ intent: correctIntent }).eq('id', already.id);
  } else {
    await supabase.from('phrases').insert({ text: phrase, intent: correctIntent });
  }
}