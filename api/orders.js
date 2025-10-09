import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

function normalize(text) {
  return text
    ?.toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[ł]/g, "l")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a, b) {
  const matrix = Array.from({ length: b.length + 1 }, (_, i) => [i]);
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      matrix[i][j] =
        b.charAt(i - 1) === a.charAt(j - 1)
          ? matrix[i - 1][j - 1]
          : Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
    }
  }
  return matrix[b.length][a.length];
}

function findBestMatch(list, query, field = "name") {
  const normQuery = normalize(query);
  let best = null;
  let bestScore = Infinity;
  let exactMatch = null;

  console.log(`🔍 Szukam "${query}" (znormalizowane: "${normQuery}") w ${list.length} pozycjach`);

  for (const el of list) {
    const name = normalize(el[field]);
    
    // Sprawdź dokładne dopasowanie (includes)
    if (name.includes(normQuery)) {
      console.log(`✅ Dokładne dopasowanie: "${el[field]}" zawiera "${query}"`);
      exactMatch = el;
      break; // Priorytet dla dokładnych dopasowań
    }
    
    // Sprawdź podobieństwo Levenshtein
    const dist = levenshtein(name, normQuery);
    console.log(`📊 "${el[field]}" → odległość: ${dist}`);
    
    if (dist < bestScore) {
      bestScore = dist;
      best = el;
    }
  }

  // Zwróć dokładne dopasowanie jeśli istnieje, w przeciwnym razie najlepsze podobieństwo
  const result = exactMatch || (bestScore <= 2 ? best : null);
  
  if (result) {
    console.log(`🎯 WYBRANE: "${result[field]}" (typ: ${exactMatch ? 'dokładne' : 'podobieństwo'})`);
  } else {
    console.log(`❌ BRAK DOPASOWANIA: najlepsza odległość: ${bestScore}`);
  }
  
  return result;
}

export default async function handler(req, res) {
  try {
    const { message, restaurant_name, user_email } = req.body;
    console.log("🟡 INPUT:", { message, restaurant_name, user_email });

    // Pobierz restauracje
    console.log("🏪 Pobieram listę restauracji...");
    const { data: restaurants, error: restErr } = await supabase.from("restaurants").select("*");
    if (restErr) throw restErr;
    console.log(`📋 Znaleziono ${restaurants?.length || 0} restauracji`);

    const restMatch = findBestMatch(restaurants, restaurant_name, "name");
    if (!restMatch) {
      console.warn("❌ Nie znaleziono restauracji:", restaurant_name);
      return res.json({ reply: `Nie mogę znaleźć restauracji "${restaurant_name}".` });
    }

    console.log("✅ Restauracja dopasowana:", restMatch.name, "(ID:", restMatch.id, ")");

    // Pobierz menu restauracji
    console.log("🍽️ Pobieram menu dla restauracji:", restMatch.id);
    const { data: menu, error: menuErr } = await supabase
      .from("menu_items")
      .select("*")
      .eq("restaurant_id", restMatch.id);

    if (menuErr || !menu?.length) {
      console.warn("❌ Brak menu dla:", restMatch.name, "Błąd:", menuErr);
      return res.json({ reply: `Nie znalazłem menu dla "${restMatch.name}".` });
    }

    console.log(`📋 Znaleziono ${menu.length} pozycji w menu:`);
    menu.forEach((item, i) => {
      console.log(`  ${i + 1}. "${item.name}" - ${item.price} zł`);
    });

    // Parsuj ilość
    let quantity = 1;
    let cleaned = message;
    const match = message.match(/(\d+)\s*x\s*(.+)/i);
    if (match) {
      quantity = parseInt(match[1]);
      cleaned = match[2];
      console.log(`🔢 Parsowanie ilości: "${message}" → ${quantity}x "${cleaned}"`);
    } else {
      console.log(`🔢 Brak ilości w komendzie, domyślnie: 1x "${cleaned}"`);
    }

    // Szukaj pozycji
    console.log("🔍 Szukam pozycji w menu...");
    const item = findBestMatch(menu, cleaned);
    if (!item) {
      console.warn("❌ Brak pozycji:", cleaned);
      return res.json({ reply: `Nie znalazłem "${cleaned}" w menu. Spróbuj powiedzieć np. "pizza" lub "burger".` });
    }

    console.log("✅ Pozycja dopasowana:", item.name, "-", item.price, "zł");

    // Dodaj zamówienie
    console.log("💾 Tworzę zamówienie w bazie danych...");
    const orderData = {
      user_email,
      restaurant_name: restMatch.name,
      item_name: item.name,
      price: item.price * quantity,
      quantity,
      status: "pending",
    };
    
    console.log("📝 Dane zamówienia:", orderData);
    
    const { data: order, error: orderErr } = await supabase.from("orders").insert([orderData]).select();

    if (orderErr) {
      console.error("❌ Błąd tworzenia zamówienia:", orderErr);
      throw orderErr;
    }

    console.log("✅ Zamówienie utworzone:", order[0]?.id);

    const response = {
      reply: `Zamówiłem ${quantity}x ${item.name} w ${restMatch.name} za ${item.price * quantity} zł.`,
      order_id: order[0]?.id,
    };
    
    console.log("📤 Odpowiedź:", response);
    res.json(response);

  } catch (err) {
    console.error("🔥 Błąd webhooka:", err);
    res.status(500).json({ error: err.message });
  }
}
}