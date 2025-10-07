// /api/dialogflow-freeflow.ts
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);
const supabaseAnon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

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
    if (tag === "get_menu") return await getMenu(req, res);
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

async function listRestaurants(req, res) {
  const { city = "Piekary Śląskie" } = req.body?.sessionInfo?.parameters || {};
  
  // Test z anon key - może service role nie ma uprawnień
  const { data, error } = await supabaseAnon.from("restaurants").select("id,name,address").limit(10);
  
  const restaurants = data || [];
  const formattedList = restaurants.map((r, i) => `${i+1}) ${r.name} — ${r.address}`).join("\n");

  // mapka numer→id do późniejszego wyboru
  const options_map = {};
  restaurants.forEach((r, i) => options_map[String(i+1)] = { restaurant_id: r.id });

  const responseText = `Jasne, znalazłem te miejsca: ${formattedList}`;

  // Pełna ścieżka do Twojej encji @RestaurantName
  const entityTypeId = "projects/primal-index-311413/locations/europe-west1/agents/2b40816b-cb06-43f7-b36e-712fcad6c0eb/entityTypes/516effbe-cd1c-4ac2-ba94-657f88ddf08a";

  return res.json({
    // Odpowiedź tekstowa
    fulfillment_response: {
      messages: [{ text: { text: [responseText] } }]
    },
    // Zapisanie danych w pamięci i DYNAMICZNA AKTUALIZACJA ENCJI
    session_info: {
      parameters: {
        restaurant_options: restaurants, // Zapisujemy całą listę, tak jak wcześniej
        options_map // Zachowujemy mapkę numer→id
      },
      session_entity_types: [{
        name: entityTypeId,
        entity_override_mode: "ENTITY_OVERRIDE_MODE_OVERRIDE",
        entities: restaurants.map(r => ({
          value: r.id,      // Używamy ID restauracji jako unikalnej wartości
          synonyms: [r.name] // Nazwa restauracji jako synonim
        }))
      }]
    }
  });
}

async function listMenu(req, res) {
  const p = req.body?.sessionInfo?.parameters || {};
  // użytkownik mógł wskazać numer z listy
  const selected = p?.selection && p?.options_map?.[p.selection];
  const restaurant_id = p.restaurant_id || selected?.restaurant_id;

  const dish = p.dish; // np. "capricciosa"
  const { data } = await supabaseAnon
    .from("menu_items")
    .select("id,name,price_cents,category")
    .eq("restaurant_id", restaurant_id)
    .ilike("name", `%${dish || ""}%`)
    .order("price_cents");

  if (!data?.length) {
    return res.json({
      fulfillment_response: { messages: [{ text: { text: ["Nie znalazłem takiej pozycji w tej restauracji."] } }] }
    });
  }

  const lines = data.map(m => `${m.name} — ${(m.price_cents/100).toFixed(2)} zł`).join("\n");
  // map nazwa→id żeby łatwo wybrać
  const items_map = {};
  data.forEach(m => { items_map[m.name] = m.id; });

  return res.json({
    sessionInfo: { parameters: { restaurant_id, items_map } },
    fulfillment_response: { messages: [{ text: { text: [lines + "\nKtóre danie wybierasz?"] } }] }
  });
}

async function createOrder(req, res) {
  const p = req.body?.sessionInfo?.parameters || {};
  const qty = Number(p.qty || 1);

  // priorytet: nazwa → id z items_map → fallback na bezpośredni menu_item_id
  let menu_item_id = p.menu_item_id;
  if (!menu_item_id && p.item_name && p.items_map?.[p.item_name]) {
    menu_item_id = p.items_map[p.item_name];
  }

  const { data: item } = await supabaseAnon.from("menu_items")
    .select("id,name,price_cents").eq("id", menu_item_id).single();

  if (!item) {
    return res.json({ fulfillment_response: { messages: [{ text: { text: ["Nie mam kompletnej pozycji menu."] } }] } });
  }

  const subtotal = item.price_cents * qty;
  const { data: order } = await supabase
    .from("orders")
    .insert({ restaurant_id: p.restaurant_id, subtotal_cents: subtotal, total_cents: subtotal, status: "new", eta: "15–20 min" })
    .select("id,eta,total_cents").single();

  await supabase.from("order_items").insert({
    order_id: order.id, menu_item_id: item.id, name: item.name, unit_price_cents: item.price_cents, qty
  });

  return res.json({
    sessionInfo: {
      parameters: {
        order_id: order.id,
        eta: order.eta,
        price_total: `${(order.total_cents/100).toFixed(2)} zł`,
        items_summary: `${qty}× ${item.name}`
      }
    },
    fulfillment_response: {
      messages: [{ text: { text: [`Zamówienie przyjęte. ${qty}× ${item.name}. Dostawa ${order.eta}.`] } }]
    }
  });
}

async function getMenu(req, res) {
  try {
    // Pobierz restaurant_id z parametrów sesji
    const restaurant_id = req.body?.sessionInfo?.parameters?.restaurant_id;
    
    if (!restaurant_id) {
      return res.json({
        fulfillment_response: { 
          messages: [{ text: { text: ["Nie mogę znaleźć ID restauracji. Spróbuj ponownie."] } }] 
        }
      });
    }

    console.log('🍽️ Getting menu for restaurant_id:', restaurant_id);

    // Wykonaj zapytanie do tabeli menu_items w Supabase
    const { data: menuItems, error } = await supabaseAnon
      .from('menu_items')
      .select('*')
      .eq('restaurant_id', restaurant_id);

    if (error) {
      console.error('❌ Supabase error:', error);
      return res.json({
        fulfillment_response: { 
          messages: [{ text: { text: ["Wystąpił błąd podczas pobierania menu."] } }] 
        }
      });
    }

    if (!menuItems || menuItems.length === 0) {
      return res.json({
        fulfillment_response: { 
          messages: [{ text: { text: ["Nie znalazłem menu dla tej restauracji."] } }] 
        }
      });
    }

    // Stwórz odpowiedź tekstową dla użytkownika
    const responseText = "Świetny wybór! Oto menu. Co podać?";

    // Stwórz odpowiedź JSON dla Dialogflow
    return res.json({
      fulfillment_response: {
        messages: [{ text: { text: [responseText] } }]
      },
      custom_payload: {
        menu_items: menuItems
      }
    });

  } catch (error) {
    console.error('❌ getMenu error:', error);
    return res.json({
      fulfillment_response: { 
        messages: [{ text: { text: ["Wystąpił błąd podczas pobierania menu."] } }] 
      }
    });
  }
}
