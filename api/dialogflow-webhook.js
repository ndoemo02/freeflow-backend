const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE, {
  auth: { persistSession: false }
});

function round5(n){ return Math.max(5, Math.round(n/5)*5); }
function etaWindow(mins){
  const low = round5(Math.max(5, Math.floor(mins * 0.8)));
  const high = round5(Math.max(low+5, Math.ceil(mins * 1.2)));
  return `${low}–${high} min`;
}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    let body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const tag = body?.fulfillmentInfo?.tag || '';
    const p   = body?.sessionInfo?.parameters || {};

    if (tag === 'recommend_nearby') {
      console.log('🎯 RECOMMEND_NEARBY HIT!');
      
      // Pobierz listę restauracji z Supabase
      const { data: restaurants, error } = await supabase
        .from('restaurants')
        .select('id, name, address, city, cuisine_type')
        .limit(10);
      
      if (error) {
        console.error('❌ Supabase error:', error);
        return res.status(200).json({
          fulfillment_response: { 
            messages: [{ text: { text: ["Wystąpił błąd podczas pobierania restauracji."] } }] 
          }
        });
      }

      const restaurantList = restaurants || [];
      const formattedList = restaurantList.map((r, i) => `${i+1}) ${r.name} — ${r.address}`).join('\n');
      
      // Pełna ścieżka do encji @RestaurantName
      const entityTypeId = "projects/primal-index-311413/locations/europe-west1/agents/2b40816b-cb06-43f7-b36e-712fcad6c0eb/entityTypes/516effbe-cd1c-4ac2-ba94-657f88ddf08a";

      return res.status(200).json({
        // a. fulfillment_response - wiadomość tekstowa dla użytkownika
        fulfillment_response: {
          messages: [{ text: { text: [`Znalazłem te restauracje w okolicy:\n${formattedList}`] } }]
        },
        // b. custom_payload - tablica obiektów restauracji dla frontendu
        custom_payload: {
          restaurants: restaurantList
        },
        // c. session_info.session_entity_types - dynamiczna aktualizacja encji
        session_info: {
          parameters: {
            restaurant_options: restaurantList,
            options_map: restaurantList.reduce((map, r, i) => {
              map[String(i+1)] = { restaurant_id: r.id };
              return map;
            }, {})
          },
          session_entity_types: [{
            name: entityTypeId,
            entity_override_mode: "ENTITY_OVERRIDE_MODE_OVERRIDE",
            entities: restaurantList.map(r => ({
              value: r.id,
              synonyms: [r.name]
            }))
          }]
        }
      });
    }

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
      const isDelivery = p.delivery ?? true;
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

      // 2) Wyciągnij dystans (jeśli delivery)
      const distance = isDelivery ? (p.restaurant_options?.[0]?.distance_km || 2) : 0;
      const drive = distance * 2; // 2 min/km
      const prep  = mi.prep_min ?? 10;

      // 3) Uwzględnij status kuchni (opcjonalnie)
      const { data: st } = await supabase
        .from('restaurant_status')
        .select('base_prep_min, per_item_min, backlog_items, peak_multiplier, manual_override_min')
        .eq('restaurant_id', mi.restaurant_id)
        .maybeSingle();

      const base   = st?.base_prep_min ?? 0;
      const per    = st?.per_item_min ?? 0;
      const queue  = st?.backlog_items ?? 0;
      const peak   = st?.peak_multiplier ?? 1;
      const manual = st?.manual_override_min;

      let mins;
      if (manual && manual > 0) {
        mins = manual;
      } else {
        mins = prep + base + (queue * per);
        if (isDelivery) mins += drive;
        mins *= peak;
      }

      const etaStr = etaWindow(mins);

      // 4) Policz ceny
      const subtotal = mi.price_cents * qty;
      const total    = subtotal;

      // 5) Zapisz zamówienie
      const { data: ord, error: ordErr } = await supabase
        .from('orders')
        .insert({
          user_id: p.user_id || null,
          restaurant_id: mi.restaurant_id,
          subtotal_cents: subtotal,
          total_cents: total,
          eta: etaStr,
          status: 'accepted',
          delivery: isDelivery
        })
        .select('id, eta')
        .single();
      if (ordErr) throw ordErr;

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
