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

function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2)**2 + Math.cos(lat1 * Math.PI / 180) *
            Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export default async function handler(req, res) {
  console.log('Webhook hit:', req.method, req.body);
  
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    console.log('🔍 BODY FROM DIALOGFLOW:', JSON.stringify(req.body, null, 2));

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const tag = body?.fulfillmentInfo?.tag || '';
    const p = body?.sessionInfo?.parameters || {};

    console.log('📩 [DialogflowCX] webhook tag:', tag);

    // 🔹 RECOMMEND_NEARBY
    if (tag === 'RECOMMEND_NEARBY') {
      const location = p.location || {};
      const userLat = location.latitude ?? 50.382; // fallback: Piekary Śląskie
      const userLon = location.longitude ?? 18.948;
      const radiusKm = Number(p.radius_km ?? 5);

      // Pobierz wszystkie restauracje z bazy danych
      const { data: restaurants, error: restaurantsError } = await supabase
        .from('restaurants')
        .select('id, name, address, lat, lng');

      if (restaurantsError) {
        console.error('Error fetching restaurants:', restaurantsError);
        return res.status(200).json({
          fulfillment_response: {
            messages: [{ text: { text: ['Błąd podczas wyszukiwania restauracji.'] } }]
          }
        });
      }

      if (!restaurants?.length) {
        return res.status(200).json({
          fulfillment_response: {
            messages: [{ text: { text: ['Nie znalazłem żadnych restauracji w bazie danych.'] } }]
          }
        });
      }

      // Oblicz dystans do każdej restauracji i filtruj
      const nearbyRestaurants = restaurants
        .map(restaurant => {
          const distance = distanceKm(userLat, userLon, restaurant.lat, restaurant.lng);
          return {
            ...restaurant,
            distance_km: distance
          };
        })
        .filter(restaurant => restaurant.distance_km <= radiusKm)
        .sort((a, b) => a.distance_km - b.distance_km)
        .slice(0, 3); // Weź tylko 3 najbliższe

      if (!nearbyRestaurants.length) {
        return res.status(200).json({
          fulfillment_response: {
            messages: [{ text: { text: [`Nie znalazłem nic w promieniu ${radiusKm} km.`] } }]
          }
        });
      }

      const list = nearbyRestaurants
        .map(r => `Restauracja ${r.name} — ok. ${r.distance_km.toFixed(1)} km, adres ${r.address}`)
        .join('\n');

      return res.status(200).json({
        fulfillment_response: {
          messages: [{ text: { text: [list] } }]
        },
        session_info: { parameters: { restaurant_options: nearbyRestaurants } }
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

      // Parsuj ETA string do min/max
      const etaMatch = ord.eta.match(/(\d+)–(\d+) min/);
      const etaMin = etaMatch ? etaMatch[1] : '15';
      const etaMax = etaMatch ? etaMatch[2] : '20';

      const response = {
        sessionInfo: {
          parameters: {
            order_id: ord.id,                 // UUID
            eta: `${etaMin}–${etaMax} min`,
            price_total: (total / 100).toFixed(2) + ' zł',
            items_summary: `${qty}× ${mi.name}`
          }
        },
        fulfillment_response: {
          messages: [
            { text: { text: [ `Zamówienie przyjęte. ${qty}× ${mi.name}. Dostawa ${etaMin}–${etaMax} min.` ] } }
          ]
        }
      };
      return res.status(200).json(response);
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
