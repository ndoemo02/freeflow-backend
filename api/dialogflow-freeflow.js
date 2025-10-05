import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE, {
  auth: { persistSession: false }
});

function round5(n) {
  return Math.max(5, Math.round(n / 5) * 5);
}

function etaWindow(mins) {
  const low = round5(Math.max(5, Math.floor(mins * 0.8)));
  const high = round5(Math.max(low + 5, Math.ceil(mins * 1.2)));
  return `${low}–${high} min`;
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const tag = body?.fulfillmentInfo?.tag || '';
    const p = body?.sessionInfo?.parameters || {};

    console.log('📩 [DialogflowCX] webhook tag:', tag);

    // 🔹 RECOMMEND_NEARBY
    if (tag === 'RECOMMEND_NEARBY') {
      const dishType = String(p.dish_type ?? '');
      const radiusKm = Number(p.radius_km ?? 10);
      const results = [
        { name: 'Rybna Fala', distance_km: 2.1 },
        { name: 'Karczma Śląska', distance_km: 3.8 },
        { name: 'Złota Okońka', distance_km: 6.4 },
      ];
      const lines = results.map(r => `${r.name} — ok. ${r.distance_km} km`).join('\n');

      return res.status(200).json({
        fulfillment_response: {
          messages: [{
            text: { text: [`Dla ${dishType || 'obiadu'} w promieniu ${radiusKm} km mam:\n${lines}\nChcesz coś do picia?`] }
          }]
        },
        session_info: { parameters: { restaurant_options: results } }
      });
    }

    // 🔹 ORDER_CREATE
    if (tag === 'ORDER_CREATE') {
      const qty = Number(p.number || 1);
      const name = String(p.food_item || '');
      const isDelivery = p.delivery ?? true;
      const restaurantId = p.restaurant_id || (p.restaurant_options?.[0]?.id) || null;

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

      const distance = isDelivery ? (p.restaurant_options?.[0]?.distance_km || 2) : 0;
      const drive = distance * 2;
      const prep = mi.prep_min ?? 10;

      const { data: st } = await supabase
        .from('restaurant_status')
        .select('base_prep_min, per_item_min, backlog_items, peak_multiplier, manual_override_min')
        .eq('restaurant_id', mi.restaurant_id)
        .maybeSingle();

      const base = st?.base_prep_min ?? 0;
      const per = st?.per_item_min ?? 0;
      const queue = st?.backlog_items ?? 0;
      const peak = st?.peak_multiplier ?? 1;
      const manual = st?.manual_override_min;

      let mins = manual && manual > 0 ? manual : (prep + base + (queue * per)) * peak + (isDelivery ? drive : 0);
      const etaStr = etaWindow(mins);

      const subtotal = mi.price_cents * qty;
      const total = subtotal;

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
        event: 'accepted'
      });

      const zl = v => (v / 100).toFixed(2).replace('.', ',') + ' zł';
      const msg = `Zamówienie #${ord.id} przyjęte: ${qty} × ${mi.name}. Suma: ${zl(total)}. Czas dostawy: ${ord.eta}.`;

      return res.status(200).json({
        fulfillment_response: { messages: [{ text: { text: [msg] } }] },
        session_info: { parameters: { order_id: ord.id, eta: ord.eta } }
      });
    }

    // 🔹 Fallback
    return res.status(200).json({
      fulfillment_response: {
        messages: [{ text: { text: ["OK, przyjąłem dane. Powiedz co chcesz zamówić."] } }]
      }
    });

  } catch (e) {
    console.error('❌ Dialogflow CX Webhook error:', e);
    return res.status(500).json({
      error: 'Internal server error',
      message: e.message
    });
  }
}
