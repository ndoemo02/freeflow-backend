import { detectIntent } from './intent-router.js';
import { saveContext, getContext, clearContext } from './memory.js';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ ok: false, error: 'Missing text' });

    const intent = await detectIntent(text);
    const context = getContext();

    // 🔹 Użytkownik mówi: 'pokaż menu' albo 'co mają do jedzenia'
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

    // 🔹 Intencja: wybrano konkretną restaurację
    if (intent.intent === 'select_restaurant' && intent.restaurant) {
      const r = intent.restaurant;
      const reply = `Świetny wybór! ${r.name} znajduje się przy ${r.address}. Chcesz zobaczyć menu?`;
      saveContext('select_restaurant', r);
      return res.json({ ok: true, reply, restaurant: r, intent: 'select_restaurant' });
    }

    // 🔹 Intencja: szukanie restauracji
    if (intent.intent === 'find_nearby') {
      const { data: restaurants } = await supabase.from('restaurants').select('*');
      if (!restaurants?.length) return res.json({ ok: false, reply: 'Nie znalazłam restauracji w bazie.' });

      const list = restaurants
        .slice(0, 5)
        .map((r, i) => `${i + 1}. ${r.name} (${r.address})`)
        .join('\n');

      const reply = `Oto restauracje w promieniu 2 kilometrów:\n${list}\nKtórą chcesz wybrać?`;
      saveContext('find_nearby');
      return res.json({ ok: true, reply, count: restaurants.length, intent: 'find_nearby' });
    }

    // 🔹 Użytkownik zmienia temat – np. mówi o lodach, hotelu, taksówce
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