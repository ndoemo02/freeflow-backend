// /api/dialogflow-freeflow.js
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);
const supabaseAnon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// Funkcja obliczania dystansu Haversine
function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // Promień Ziemi w km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + 
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
            Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export default async function handler(req, res) {
  const { fulfillmentInfo, sessionInfo } = req.body || {};
  const tag = fulfillmentInfo?.tag;
  
  console.log('🚀 WEBHOOK HIT - tag:', tag, 'body:', JSON.stringify(req.body, null, 2));

  try {
    if (tag === "recommend_nearby") {
      console.log('🎯 RECOMMEND_NEARBY HIT!');
      return await listRestaurants(req, res);
    }
    if (tag === "list_restaurants") return await listRestaurants(req, res);
    if (tag === "list_menu") return await listMenu(req, res);
    if (tag === "create_order") return await createOrder(req, res);
    console.log('❌ UNKNOWN TAG:', tag);
    return res.json({ fulfillment_response: { messages: [{ text: { text: ["Brak obsługi tagu."] } }] } });
  } catch (e) {
    console.error("WEBHOOK ERROR", e, req.body);
    return res.status(200).json({
      fulfillment_response: { messages: [{ text: { text: ["Ups, błąd serwera. Spróbuj ponownie."] } }] }
    });
  }
}

// Lista restauracji
async function listRestaurants(req, res) {
  const params = req.body?.sessionInfo?.parameters || {};
  const city = params.city || params.location || "Piekary Śląskie";
  
  console.log('🏪 LIST RESTAURANTS - city:', city);
  
  try {
    const { data: restaurants, error } = await supabaseAnon
      .from("restaurants")
      .select("id, name, address, city, latitude, longitude")
      .eq("city", city)
      .limit(10);

    if (error) {
      console.error('Supabase error:', error);
      return res.json({ 
        fulfillment_response: { 
          messages: [{ text: { text: ["Błąd pobierania restauracji."] } }] 
        } 
      });
    }

    if (!restaurants || restaurants.length === 0) {
      return res.json({ 
        fulfillment_response: { 
          messages: [{ text: { text: ["Nie znaleziono lokali."] } }] 
        } 
      });
    }

    const lines = restaurants.map((r, i) => 
      `${i + 1}) ${r.name} — ${r.address}`
    ).join('\n');

    // Mapa opcji dla późniejszego wyboru
    const options_map = {};
    restaurants.forEach((r, i) => {
      options_map[String(i + 1)] = { restaurant_id: r.id };
    });

    return res.json({
      sessionInfo: { parameters: { options_map } },
      fulfillment_response: { 
        messages: [{ text: { text: [lines] } }] 
      }
    });
  } catch (e) {
    console.error('listRestaurants error:', e);
    return res.json({ 
      fulfillment_response: { 
        messages: [{ text: { text: ["Błąd serwera."] } }] 
      } 
    });
  }
}

// Lista menu restauracji
async function listMenu(req, res) {
  const params = req.body?.sessionInfo?.parameters || {};
  const restaurant_id = params.restaurant_id;
  const dish = params.dish || "";
  
  console.log('🍽️ LIST MENU - restaurant_id:', restaurant_id, 'dish:', dish);
  
  if (!restaurant_id) {
    return res.json({ 
      fulfillment_response: { 
        messages: [{ text: { text: ["Brak ID restauracji."] } }] 
      } 
    });
  }

  try {
    const { data: menuItems, error } = await supabaseAnon
      .from("menu_items")
      .select("id, name, price_cents, category, items_map")
      .eq("restaurant_id", restaurant_id)
      .ilike("name", `%${dish}%`)
      .order("price_cents");

    if (error) {
      console.error('Supabase error:', error);
      return res.json({ 
        fulfillment_response: { 
          messages: [{ text: { text: ["Błąd pobierania menu."] } }] 
        } 
      });
    }

    if (!menuItems || menuItems.length === 0) {
      return res.json({ 
        fulfillment_response: { 
          messages: [{ text: { text: ["Nie znalazłem takiej pozycji w tej restauracji."] } }] 
        } 
      });
    }

    const lines = menuItems.map(m => 
      `${m.name} — ${(m.price_cents / 100).toFixed(2)} zł`
    ).join('\n');

    // Mapa rozmiarów dla łatwego wyboru
    const sizes_map = {};
    menuItems.forEach(m => {
      if (m.items_map) {
        Object.keys(m.items_map).forEach(size => {
          sizes_map[size] = m.id;
        });
      }
    });

    return res.json({
      sessionInfo: { parameters: { restaurant_id, sizes_map } },
      fulfillment_response: { 
        messages: [{ text: { text: [lines + "\nJaki rozmiar?"] } }] 
      }
    });
  } catch (e) {
    console.error('listMenu error:', e);
    return res.json({ 
      fulfillment_response: { 
        messages: [{ text: { text: ["Błąd serwera."] } }] 
      } 
    });
  }
}

// Tworzenie zamówienia
async function createOrder(req, res) {
  const params = req.body?.sessionInfo?.parameters || {};
  const qty = Number(params.qty || params.number || 1);
  const restaurant_id = params.restaurant_id;
  const item_name = params.food_item || params.dish || "";
  
  console.log('🛒 CREATE ORDER - restaurant_id:', restaurant_id, 'item:', item_name, 'qty:', qty);
  
  if (!restaurant_id || !item_name) {
    return res.json({ 
      fulfillment_response: { 
        messages: [{ text: { text: ["Brak kompletnych danych zamówienia."] } }] 
      } 
    });
  }

  try {
    // Znajdź pozycję menu
    const { data: menuItem, error: menuError } = await supabaseAnon
      .from("menu_items")
      .select("id, name, price_cents, restaurant_id")
      .eq("restaurant_id", restaurant_id)
      .ilike("name", `%${item_name}%`)
      .single();

    if (menuError || !menuItem) {
      console.error('Menu item error:', menuError);
      return res.json({ 
        fulfillment_response: { 
          messages: [{ text: { text: ["Nie znalazłem tej pozycji w menu."] } }] 
        } 
      });
    }

    const subtotal = menuItem.price_cents * qty;
    const eta = "15–20 min";

    // Utwórz zamówienie
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .insert({
        restaurant_id: restaurant_id,
        subtotal_cents: subtotal,
        total_cents: subtotal,
        status: "new",
        eta: eta
      })
      .select("id, eta, total_cents")
      .single();

    if (orderError) {
      console.error('Order creation error:', orderError);
      return res.json({ 
        fulfillment_response: { 
          messages: [{ text: { text: ["Błąd tworzenia zamówienia."] } }] 
        } 
      });
    }

    // Dodaj pozycje zamówienia
    await supabase.from("order_items").insert({
      order_id: order.id,
      menu_item_id: menuItem.id,
      name: menuItem.name,
      unit_price_cents: menuItem.price_cents,
      qty: qty
    });

    // Dodaj event
    await supabase.from("order_events").insert({
      order_id: order.id,
      event: "created",
      note: "Zamówienie utworzone"
    });

    const priceTotal = (order.total_cents / 100).toFixed(2).replace('.', ',') + ' zł';
    const itemsSummary = `${qty}× ${menuItem.name}`;

    return res.json({
      sessionInfo: { 
        parameters: { 
          order_id: order.id, 
          eta: order.eta, 
          price_total: priceTotal,
          items_summary: itemsSummary
        } 
      },
      fulfillment_response: { 
        messages: [{ 
          text: { 
            text: [`Zamówienie #${order.id} przyjęte: ${itemsSummary}. Suma: ${priceTotal}. Czas: ${order.eta}.`] 
          } 
        }] 
      }
    });
  } catch (e) {
    console.error('createOrder error:', e);
    return res.json({ 
      fulfillment_response: { 
        messages: [{ text: { text: ["Błąd serwera."] } }] 
      } 
    });
  }
}
