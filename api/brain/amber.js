import { detectIntent } from './intent-router.js';
import { saveContext, getContext, clearContext } from './memory.js';
import { createClient } from '@supabase/supabase-js';
import { applyCORS } from '../_cors.js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (applyCORS(res)) return; // 👈 ważne: obsługuje preflight

  try {
    const { text, lat, lng } = req.body;
    if (!text) return res.status(400).json({ ok: false, error: 'Missing text' });

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

      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "http://localhost:3000";

      const nearbyUrl = `${baseUrl}/api/restaurants/nearby?lat=${lat}&lng=${lng}&radius=2`;
      const nearbyRes = await fetch(nearbyUrl);
      const { nearby } = await nearbyRes.json();

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
    }

    // 🔹 Zmiana tematu (np. lody, hotel, taxi)
    if (/(lody|hotel|taxi|przewóz|nocleg)/i.test(text)) {
      clearContext();
      return res.json({ ok: true, reply: 'Okej! Zmieniam temat. Powiedz, czego potrzebujesz teraz.', intent: 'topic_change' });
    }

    // 🔹 Fallback neutralny
    return res.json({ ok: true, reply: 'Nie jestem pewna, co masz na myśli — możesz powtórzyć?', intent: 'none' });
  } catch (err) {
    console.error('Amber Brain error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
}