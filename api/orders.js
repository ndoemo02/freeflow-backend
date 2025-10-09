import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

function normalize(text) {
  return text
    ?.toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[ł]/g, "l")
    .replace(/\s+/g, " ")
    .trim();
}

// Proste dopasowanie z tolerancją na literówki
function levenshtein(a, b) {
  const matrix = Array.from({ length: b.length + 1 }, (_, i) => [i]);
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      matrix[i][j] =
        b.charAt(i - 1) === a.charAt(j - 1)
          ? matrix[i - 1][j - 1]
          : Math.min(
              matrix[i - 1][j - 1] + 1, // substitution
              matrix[i][j - 1] + 1,     // insertion
              matrix[i - 1][j] + 1      // deletion
            );
    }
  }
  return matrix[b.length][a.length];
}

function findBestMatch(menu, query) {
  const normQuery = normalize(query);
  let bestMatch = null;
  let bestScore = Infinity;

  for (const item of menu) {
    const normItem = normalize(item.name);
    const distance = levenshtein(normItem, normQuery);

    // Idealne dopasowanie
    if (normItem.includes(normQuery)) return item;

    // Najbliższe dopasowanie przy literówkach
    if (distance < bestScore) {
      bestScore = distance;
      bestMatch = item;
    }
  }

  // Jeśli różnica <= 2, uznaj za trafienie
  return bestScore <= 2 ? bestMatch : null;
}

export default async function handler(req, res) {
  try {
    const { message, restaurant_name, user_email } = req.body;

    if (!message || !restaurant_name) {
      return res.status(400).json({ error: "Brak danych wejściowych" });
    }

    // Parsowanie liczby (np. "2x pizza diavola")
    let quantity = 1;
    let cleaned = message;
    const match = message.match(/(\d+)\s*x\s*(.+)/i);
    if (match) {
      quantity = parseInt(match[1]);
      cleaned = match[2];
    }

    // Pobranie menu z Supabase
    const { data: menu, error } = await supabase
      .from("menu_items")
      .select("*")
      .eq("restaurant_name", restaurant_name);

    if (error || !menu?.length) {
      console.error("Błąd pobierania menu:", error);
      return res.json({
        reply: `Nie mogę pobrać menu dla "${restaurant_name}".`,
      });
    }

    // Szukanie najlepszego dopasowania
    const item = findBestMatch(menu, cleaned);

    if (!item) {
      return res.json({
        reply: `Nie znalazłem "${cleaned}" w menu. Spróbuj powiedzieć coś w stylu "pizza" lub "burger".`,
      });
    }

    // Zapisz zamówienie do Supabase
    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .insert([
        {
          user_email,
          restaurant_name,
          item_name: item.name,
          price: item.price * quantity,
          quantity,
          status: "pending",
        },
      ])
      .select();

    if (orderErr) throw orderErr;

    res.json({
      success: true,
      reply: `Zamówiłem ${quantity}x ${item.name} w restauracji ${restaurant_name} za ${item.price * quantity} zł.`,
      order_id: order?.[0]?.id,
    });
  } catch (err) {
    console.error("Błąd webhooka:", err);
    res.status(500).json({ error: err.message });
  }
}