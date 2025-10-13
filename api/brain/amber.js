import { detectIntent } from './intent-router.js';
import { saveContext, getContext, clearContext } from './memory.js';
import { supabase } from '../_supabase.js';
import { applyCORS } from '../_cors.js';

export default async function handler(req, res) {
  if (applyCORS(req, res)) return; // 👈 ważne: obsługuje preflight

  try {
    // 🔍 obsługa danych wejściowych (zależnie od środowiska)
    let body = {};

    if (req.body) {
      body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    } else if (typeof req.text === "function") {
      // Edge-style Request
      const text = await req.text();
      body = JSON.parse(text);
    } else if (req instanceof Request) {
      // Dla fetch API Request
      body = await req.json();
    } else {
      throw new Error("❌ Nie udało się sparsować request body");
    }

    const { text, lat, lng } = body;
    if (!text) {
      return res.status(400).json({ ok: false, error: "Brak tekstu w żądaniu" });
    }

    // 💡 Twoja dalsza logika Amber Brain tutaj...
    console.log("🧠 Amber Brain processing:", text);

    const intent = await detectIntent(text);
    const context = getContext();

    // 🔹 Pokaż menu z kontekstu
    if (/(menu|co mają|zobaczyć menu|co zjeść)/i.test(text)) {
      if (context.lastRestaurant) {
        const r = context.lastRestaurant;
        const reply = `Menu restauracji ${r.name} jest dostępne. Chcesz, żebym przeczytała kilka propozycji?`;
        saveContext('menu_request', r);
        return res.json({ ok: true, reply, intent: 'menu_request', restaurant: r });
      } else {
        return res.json({ ok: true, reply: 'Nie pamiętam, o której restauracji mówiliśmy. Możesz powtórzyć nazwę?', intent: 'menu_request' });
      }
    }

    // 🔹 Wybrano konkretną restaurację
    if (intent.intent === 'select_restaurant' && intent.restaurant) {
      const r = intent.restaurant;
      const reply = `Świetny wybór! ${r.name} znajduje się przy ${r.address}. Chcesz zobaczyć menu?`;
      saveContext('select_restaurant', r);
      return res.json({ ok: true, reply, restaurant: r, intent: 'select_restaurant' });
    }

    // 🔹 Szukanie restauracji z odległością
    if (intent.intent === 'find_nearby') {
      if (!lat || !lng) {
        return res.json({ ok: false, reply: 'Nie znam Twojej lokalizacji. Powiedz, gdzie jesteś.' });
      }

      const baseUrl =
        process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : "https://freeflow-backend.vercel.app"; // fallback na produkcję

      try {
        const response = await fetch(`${baseUrl}/api/restaurants/nearby?lat=${lat}&lng=${lng}&radius=2`, {
          method: "GET",
          headers: { "Content-Type": "application/json" },
        });

        // 🔒 Sprawdź czy nie zwróciło HTML błędu
        const contentType = response.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
          const html = await response.text();
          throw new Error(`Invalid JSON response: ${html.slice(0, 100)}...`);
        }

        const data = await response.json();
        const { nearby } = data;

        if (!nearby?.length) {
          return res.json({ ok: true, reply: 'Nie znalazłam żadnych restauracji w pobliżu.', intent: 'find_nearby' });
        }

        const formatted = nearby
          .slice(0, 5)
          .map((r, i) => {
            const dist = r.distance_km < 1 ? `${Math.round(r.distance_km * 1000)} metrów` : `${r.distance_km.toFixed(1)} km`;
            return `${i + 1}. ${r.name} (${dist}, ${r.address})`;
          })
          .join('\n');

        const reply = `Oto restauracje w promieniu 2 kilometrów:\n${formatted}\nKtórą chcesz wybrać?`;
        saveContext('find_nearby');
        return res.json({ ok: true, reply, count: nearby.length, intent: 'find_nearby' });
      } catch (err) {
        console.error("Amber Brain fatal error:", err);
        return res.status(500).json({
          ok: false,
          error: err.message || "Unexpected response from context fetch",
        });
      }
    }

    // 🔹 Zmiana tematu (np. lody, hotel, taxi)
    if (/(lody|hotel|taxi|przewóz|nocleg)/i.test(text)) {
      clearContext();
      return res.json({ ok: true, reply: 'Okej! Zmieniam temat. Powiedz, czego potrzebujesz teraz.', intent: 'topic_change' });
    }

    // 🔹 Fallback neutralny
    return res.json({ ok: true, reply: 'Nie jestem pewna, co masz na myśli — możesz powtórzyć?', intent: 'none' });
  } catch (err) {
    console.error("Amber Brain fatal error:", err);
    return res.status(500).json({
      ok: false,
      error: err.message || "Internal server error"
    });
  }
}