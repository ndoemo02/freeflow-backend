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

  try {
    // --- Korekta STT / lokalizacji ---
    let normalizedText = text.toLowerCase()
      .replace(/\bsokolica\b/g, "okolicy") // typowa halucynacja STT
      .replace(/\bw\s*okolice\b/g, "w okolicy") // brak spacji itp.
      .replace(/\bw\s*okolicach\b/g, "w okolicy")
      .replace(/\bpizzeriach\b/g, "pizzerie") // dopasowanie intencji
      .trim();

    const lower = normalize(normalizedText);

    // Bazowe słowa kluczowe (bez duplikatów) — ZNORMALIZOWANE
    const findNearbyKeywords = [
      'zjeść', 'restaurac', 'pizza', 'kebab', 'burger', 'zjeść coś', 'gdzie',
      'w okolicy', 'blisko', 'coś do jedzenia', 'posiłek', 'obiad',
      'gdzie zjem', 'co polecasz', 'restauracje w pobliżu',
      'mam ochotę', 'ochotę na', 'chcę coś', 'szukam', 'szukam czegoś',
      'coś azjatyckiego', 'coś lokalnego', 'coś szybkiego'
    ];

    const menuKeywords = [
      'menu', 'co moge zjesc', 'co maja', 'pokaz menu', 'co jest w menu',
      'dania', 'potrawy', 'co serwuja', 'co podaja', 'karta dan'
    ];

    const orderKeywords = [
      'zamow', 'poproshe', 'chce zamowic', 'zloz zamowienie', 'zamowic cos',
      'dodaj do zamowienia', 'zloz', 'wybieram', 'biore', 'wezme'
      // Usunięto 'chce' — zbyt ogólne, koliduje z "chcę coś szybkiego" (find_nearby)
    ];

    // Pobierz nauczone frazy z bazy
    const { data: learned } = await supabase
      .from('phrases')
      .select('text, intent');

    const learnedNearby = learned?.filter(p => p.intent === 'find_nearby') || [];
    const learnedMenu = learned?.filter(p => p.intent === 'menu_request') || [];
    const learnedOrder = learned?.filter(p => p.intent === 'create_order') || [];

    const dynamicNearbyKeywords = learnedNearby.map(p => normalize(p.text));
    const dynamicMenuKeywords = learnedMenu.map(p => normalize(p.text));
    const dynamicOrderKeywords = learnedOrder.map(p => normalize(p.text));

    // Deduplikacja — usuń duplikaty między bazowymi a dynamicznymi
    const allNearbyKeywords = [...new Set([...findNearbyKeywords, ...dynamicNearbyKeywords])];
    const allMenuKeywords = [...new Set([...menuKeywords, ...dynamicMenuKeywords])];
    const allOrderKeywords = [...new Set([...orderKeywords, ...dynamicOrderKeywords])];

    // 🔹 PRIORYTET 0: Sprawdź czy w tekście jest ilość (2x, 3x, "dwa razy", etc.)
    // Jeśli tak, to najprawdopodobniej user chce zamówić, nie wybierać restauracji
    const quantityPattern = /(\d+\s*x|\d+\s+razy|dwa\s+razy|trzy\s+razy|kilka)/i;
    if (quantityPattern.test(text)) {
      console.log('🔢 Quantity detected → create_order');
      return { intent: 'create_order', restaurant: null };
    }

    // 🔹 PRIORYTET 1: Sprawdź czy w tekście jest nazwa restauracji (fuzzy matching)
    // Jeśli tak, to najprawdopodobniej user chce wybrać restaurację lub zobaczyć menu
    const { data: restaurantsList } = await supabase
      .from('restaurants')
      .select('id, name');

    if (restaurantsList?.length) {
      const normalizedText = normalize(text);
      for (const r of restaurantsList) {
        const normalizedName = normalize(r.name);

        // Sprawdź czy nazwa restauracji jest w tekście (fuzzy match)
        // 1. Exact substring match
        if (normalizedText.includes(normalizedName)) {
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

        for (const nameWord of nameWords) {
          for (const textWord of textWords) {
            if (textWord === nameWord || levenshtein(textWord, nameWord) <= 1) {
              matchedWords++;
              break;
            }
          }
        }

        // Jeśli ≥50% słów z nazwy restauracji pasuje → uznaj za match
        if (matchedWords >= Math.ceil(nameWords.length / 2)) {
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
      }
    }

    // 🔹 PRIORYTET 2: Sprawdź menu keywords (bardziej specyficzne niż order)
    if (allMenuKeywords.some(k => lower.includes(k))) {
      return { intent: 'menu_request', restaurant: null };
    }

    // 🔹 PRIORYTET 3: Sprawdź order keywords
    if (allOrderKeywords.some(k => lower.includes(k))) {
      return { intent: 'create_order', restaurant: null };
    }

    // 🔹 PRIORYTET 4: Sprawdź nearby keywords
    if (allNearbyKeywords.some(k => lower.includes(k))) {
      return { intent: 'find_nearby', restaurant: null };
    }

    // Jeśli Amber nie zna frazy — zapisuje ją do bazy do przyszłego uczenia
    try {
      await supabase.from('phrases').insert({ text: text, intent: 'none' });
    } catch (err) {
      console.warn('⚠️ Phrase insert skipped:', err.message);
    }

    return { intent: 'none', restaurant: null };
  } catch (err) {
    console.error('🧠 detectIntent error:', err.message);
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
    const normalized = normalize(phrase);
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