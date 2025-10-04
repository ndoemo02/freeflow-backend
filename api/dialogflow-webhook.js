import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

function round5(n){ return Math.max(5, Math.round(n/5)*5); }
function etaWindow(mins){
  const low = round5(Math.max(5, Math.floor(mins * 0.8)));
  const high = round5(Math.max(low+5, Math.ceil(mins * 1.2)));
  return `${low}–${high} min`;
}

export default async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    let body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const tag = body?.fulfillmentInfo?.tag || '';
    const p   = body?.sessionInfo?.parameters || {};

    if (tag === 'PLACES_RECS') {
      const dishType = String(p.dish_type ?? '');
      const radiusKm = Number(p.radius_km ?? 10);
      const results = [
        { name: 'Rybna Fala',     distance_km: 2.1 },
        { name: 'Karczma Śląska', distance_km: 3.8 },
        { name: 'Złota Okońka',   distance_km: 6.4 },
      ];
      const lines = results.map(r => `${r.name} — ok. ${r.distance_km} km`).join('\n');

      return res.status(200).json({
        fulfillment_response: { messages: [{ text: { text: [
          `Dla ${dishType} w promieniu ${radiusKm} km mam:\n${lines}\nChcesz coś do picia?`
        ]}}]},
        session_info: { parameters: { restaurant_options: results } }
      });
    }

    if (tag === 'ORDER_CREATE') {
      const qty  = Number(p.number || 1);
      const name = String(p.food_item || '');
      let restaurantId = p.restaurant_id || (p.restaurant_options?.[0]?.id) || null;

      // 1) Pobierz danie z menu z prep_min
      const { data: mi, error: miErr } = await supabase
        .from('menu_items')
        .select('id, name, price_cents, restaurant_id, prep_min')
        .eq('restaurant_id', restaurantId)
        .eq('name', name)
        .single();
      if (miErr || !mi) {
        console.error('menu_items error', miErr);
        return res.status(200).json({
          fulfillment_response: { messages: [{ text: { text: ['Nie znalazłem tej pozycji w menu.'] } }] }
        });
      }

      // 2) Wyciągnij dystans z rekomendacji
      const distance = p.restaurant_options?.[0]?.distance_km || 2;
      // czas dojazdu: 2 min/km (prosto na start)
      const drive = distance * 2;
      const prep  = mi.prep_min ?? 10;

      const etaStr = etaWindow(prep + drive);

      // 3) Policz ceny
      const subtotal = mi.price_cents * qty;
      const total    = subtotal;

      // 4) Zapisz zamówienie
      const { data: ord } = await supabase
        .from('orders')
        .insert({
          user_id: p.user_id || null,
          restaurant_id: mi.restaurant_id,
          subtotal_cents: subtotal,
          total_cents: total,
          eta: etaStr,
          status: 'accepted'
        })
        .select('id, eta')
        .single();

      await supabase.from('order_items').insert({
        order_id: ord.id,
        menu_item_id: mi.id,
        name: mi.name,
        unit_price_cents: mi.price_cents,
        qty
      });

      await supabase.from('order_events').insert({
        order_id: ord.id,
        event: 'accepted',
        note: null
      });

      const zl = (v)=> (v/100).toFixed(2).replace('.', ',') + ' zł';
      const msg = `Zamówienie #${ord.id} przyjęte: ${qty} × ${mi.name}. Suma: ${zl(total)}. Czas: ${ord.eta}.`;
      return res.status(200).json({
        fulfillment_response: { messages: [{ text: { text: [msg] } }] },
        session_info: { parameters: { order_id: ord.id, eta: ord.eta } }
      });
    }

    return res.status(200).json({
      fulfillment_response: { messages: [{ text: { text: ['OK.'] } }] }
    });
  } catch (e) {
    console.error('DF CX ORDER_CREATE ERR', e);
    return res.status(200).json({
      fulfillment_response: { messages: [{ text: { text: ['Błąd serwera testowego.'] } }] }
    });
  }
};
