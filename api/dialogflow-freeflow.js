// /api/dialogflow-freeflow.ts
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);
const supabaseAnon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

export default async function handler(req, res) {
  const { fulfillmentInfo, sessionInfo } = req.body || {};
  const tag = fulfillmentInfo?.tag;
  
  console.log('🚀 WEBHOOK HIT - tag:', tag);
  console.log('📋 Full request body:', JSON.stringify(req.body, null, 2));
  console.log('🔍 SessionInfo:', JSON.stringify(sessionInfo, null, 2));
  console.log('🏷️ FulfillmentInfo:', JSON.stringify(fulfillmentInfo, null, 2));

  try {
    if (tag === "recommend_nearby") {
      console.log('🎯 RECOMMEND_NEARBY HIT!');
      return await listRestaurants(req, res);
    }
    if (tag === "list_restaurants") return await listRestaurants(req, res);
    if (tag === "list_menu") return await listMenu(req, res);
    if (tag === "get_menu") return await getMenu(req, res);
    if (tag === "select_restaurant") return await selectRestaurant(req, res);
    if (tag === "create_order") return await createOrder(req, res);
    if (tag === "diag_menu_probe") return await diagMenuProbe(req, res);
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
  
  // Pobierz listę restauracji z Supabase
  const { data: restaurants, error } = await supabase
    .from("restaurants")
    .select("id, name, address, city, cuisine_type")
    .limit(10);
  
  if (error) {
    console.error('❌ Supabase error:', error);
    return res.json({
      fulfillment_response: { 
        messages: [{ text: { text: ["Wystąpił błąd podczas pobierania restauracji."] } }] 
      }
    });
  }

  const restaurantList = restaurants || [];
  const formattedList = restaurantList.map((r, i) => `${i+1}) ${r.name} — ${r.address}`).join("\n");
  
  // Pełna ścieżka do encji @RestaurantName
  const entityTypeId = "projects/primal-index-311413/locations/europe-west1/agents/2b40816b-cb06-43f7-b36e-712fcad6c0eb/entityTypes/516effbe-cd1c-4ac2-ba94-657f88ddf08a";

  return res.json({
    // a. fulfillment_response - wiadomość tekstowa dla użytkownika
    fulfillment_response: {
      messages: [{ text: { text: [`Znalazłem te restauracje w okolicy:\n${formattedList}`] } }]
    },
    // b. custom_payload - tablica obiektów restauracji dla frontendu
    custom_payload: {
      restaurants: restaurantList
    },
    // c. sessionInfo.sessionEntityTypes - dynamiczna aktualizacja encji
    sessionInfo: {
      parameters: {
        restaurant_options: restaurantList,
        options_map: restaurantList.reduce((map, r, i) => {
          map[String(i+1)] = { restaurant_id: r.id };
          return map;
        }, {}),
        // Dodaj mapę nazwa→ID dla łatwego wyszukiwania
        restaurant_name_to_id: restaurantList.reduce((map, r) => {
          map[r.name] = r.id;
          return map;
        }, {})
      },
      sessionEntityTypes: [{
        name: entityTypeId,
        entity_override_mode: "ENTITY_OVERRIDE_MODE_OVERRIDE",
        entities: restaurantList.map(r => ({
          value: r.name,    // ✅ Używamy nazwy restauracji jako wartości
          synonyms: [r.name]
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
  try {
    console.log("📦 [createOrder] Params:", JSON.stringify(req.body?.sessionInfo?.parameters, null, 2));

    const params = req.body?.sessionInfo?.parameters || {};
    const { restaurant_id, item_name, menu_item_id } = params;

    if (!restaurant_id) {
      throw new Error("Brak restaurant_id w sesji!");
    }

    let itemId = menu_item_id;

    if (!itemId && item_name && params.items_map) {
      itemId = params.items_map[item_name];
    }

    if (!itemId) {
      throw new Error(`Nie znaleziono ID pozycji menu dla: ${item_name}`);
    }

    console.log(`🔍 Szukam pozycji menu: ${item_name} (${itemId})`);

    const { data: menuItem, error: menuErr } = await supabaseAnon
      .from('menu_items')
      .select('id, name, price, restaurant_id')
      .eq('id', itemId)
      .maybeSingle();

    if (menuErr) throw new Error(`Błąd zapytania Supabase: ${menuErr.message}`);
    if (!menuItem) throw new Error(`Nie znaleziono pozycji menu o ID ${itemId}`);

    console.log(`✅ Znaleziono: ${menuItem.name} - ${menuItem.price} zł`);

    const order = {
      restaurant_id: restaurant_id,
      total_price: menuItem.price,
      status: 'pending',
      created_at: new Date().toISOString(),
    };

    const { data: insertedOrder, error: orderErr } = await supabaseAnon
      .from('orders')
      .insert(order)
      .select()
      .single();

    if (orderErr) throw new Error(`Nie udało się utworzyć zamówienia: ${orderErr.message}`);

    await supabaseAnon
      .from('order_items')
      .insert({
        order_id: insertedOrder.id,
        menu_item_id: menuItem.id,
        quantity: 1,
        price: menuItem.price,
      });

    console.log("🧾 Zamówienie utworzone:", insertedOrder.id);

    return res.json({
      fulfillment_response: {
        messages: [
          { text: { text: [`Zamówienie przyjęte: ${menuItem.name} (${menuItem.price} zł)`] } },
        ],
      },
    });

  } catch (e) {
    console.error("createOrder error:", e);
    return res.json({
      fulfillment_response: { messages: [{ text: { text: [e.message || "Wystąpił błąd po stronie serwera przy tworzeniu zamówienia."] } }] }
    });
  }
}

// Helper function to get menu for a restaurant
async function getMenuForRestaurant(restaurantId) {
  const { data: menuItems, error } = await supabase
    .from('menu_items')
    .select('*')
    .eq('restaurant_id', restaurantId);

  if (error || !menuItems || menuItems.length === 0) {
    // Fallback menu data
    return [
      { id: '1', name: 'Pizza Margherita', price_cents: 2599, category: 'Pizza', restaurant_id: restaurantId },
      { id: '2', name: 'Pizza Pepperoni', price_cents: 2899, category: 'Pizza', restaurant_id: restaurantId },
      { id: '3', name: 'Spaghetti Carbonara', price_cents: 2299, category: 'Pasta', restaurant_id: restaurantId },
      { id: '4', name: 'Schabowy z ziemniakami', price_cents: 1899, category: 'Dania główne', restaurant_id: restaurantId },
      { id: '5', name: 'Zupa pomidorowa', price_cents: 899, category: 'Zupy', restaurant_id: restaurantId }
    ];
  }

  return menuItems;
}

async function selectRestaurant(req, res) {
  try {
    console.log('🎯 SELECT_RESTAURANT HIT!');
    
    const selectedName = req.body?.sessionInfo?.parameters?.RestaurantName;
    console.log('🍽️ Selected restaurant name:', selectedName);
    
    // Pobierz mapę nazwa→ID z parametrów sesji (zapisana przez recommend_nearby)
    const nameToIdMap = req.body?.sessionInfo?.parameters?.restaurant_name_to_id || {};
    console.log('🗺️ Name to ID map:', nameToIdMap);
    
    const restaurant_id = nameToIdMap[selectedName];
    
    if (!restaurant_id) {
      console.log('❌ Restaurant not found in map:', selectedName);
      return res.json({
        fulfillment_response: {
          messages: [{ text: { text: ["Nie udało się zidentyfikować wybranej restauracji. Spróbuj ponownie."] } }]
        }
      });
    }

    console.log('✅ Found restaurant ID:', restaurant_id);

    return res.json({
      sessionInfo: {
        parameters: {
          restaurant_id: restaurant_id
        }
      },
      fulfillment_response: {
        messages: [{ text: { text: [`Wybrano: ${selectedName}`] } }]
      }
    });

  } catch (error) {
    console.error('❌ selectRestaurant error:', error);
    return res.json({
      fulfillment_response: { 
        messages: [{ text: { text: ["Wystąpił błąd podczas wyboru restauracji."] } }] 
      }
    });
  }
}

async function getMenu(req, res) {
  try {
    // Debug: sprawdź wszystkie parametry sesji
    console.log('🔍 All session parameters:', req.body?.sessionInfo?.parameters);
    
    // 1. Pobierz ID restauracji z parametrów sesji (zapisane przez select_restaurant)
    let restaurantId = req.body?.sessionInfo?.parameters?.restaurant_id;
    
    console.log('🍽️ Restaurant ID parameter:', restaurantId);
    
    // 2. Fallback: spróbuj znaleźć przez mapę nazwa→ID (dla kompatybilności)
    if (!restaurantId) {
      const restaurantName = req.body?.sessionInfo?.parameters?.RestaurantName;
      const nameToIdMap = req.body?.sessionInfo?.parameters?.restaurant_name_to_id || {};
      
      console.log('🔍 Restaurant name from parameters:', restaurantName);
      console.log('🗺️ Name to ID map:', nameToIdMap);
      
      if (restaurantName && nameToIdMap[restaurantName]) {
        restaurantId = nameToIdMap[restaurantName];
        console.log('✅ Found restaurant ID from name map:', restaurantId);
      }
    }
    
    // 3. Sprawdź czy ID restauracji zostało znalezione
    if (!restaurantId) {
      console.log('❌ No restaurant ID found in parameters');
      
      // Fallback: spróbuj znaleźć restaurację po nazwie w tekście użytkownika
      const userText = req.body?.queryResult?.queryText || '';
      console.log('🔍 User text for fallback search:', userText);
      
      if (userText.toLowerCase().includes('callzone')) {
        // Znajdź ID restauracji Callzone w bazie
        const { data: callzoneRestaurant } = await supabase
          .from('restaurants')
          .select('id')
          .ilike('name', '%callzone%')
          .single();
          
        if (callzoneRestaurant) {
          console.log('✅ Found Callzone restaurant by name:', callzoneRestaurant.id);
          // Użyj znalezionego ID
          const menuItems = await getMenuForRestaurant(callzoneRestaurant.id);
          return res.json({
            fulfillment_response: {
              messages: [{ text: { text: ["Świetny wybór! Oto menu Callzone. Co podać?"] } }]
            },
            custom_payload: {
              menu_items: menuItems
            }
          });
        }
      }
      
      return res.json({
        fulfillment_response: { 
          messages: [{ text: { text: ["Nie udało się zidentyfikować wybranej restauracji. Spróbuj ponownie."] } }] 
        }
      });
    }

    console.log('🍽️ Getting menu for restaurant_id:', restaurantId);

    // 3. Wykonaj zapytanie do tabeli menu_items w Supabase
    const { data: menuItems, error } = await supabase
      .from('menu_items')
      .select('*')
      .eq('restaurant_id', restaurantId);

    if (error) {
      console.error('❌ Supabase error:', error);
      return res.json({
        fulfillment_response: { 
          messages: [{ text: { text: [`Błąd Supabase: ${error.message}`] } }] 
        }
      });
    }

    if (!menuItems || menuItems.length === 0) {
      console.log('⚠️ No menu items found, using fallback data');
      // Fallback menu data
      const fallbackMenu = [
        { id: '1', name: 'Pizza Margherita', price_cents: 2599, category: 'Pizza', restaurant_id: restaurantId },
        { id: '2', name: 'Pizza Pepperoni', price_cents: 2899, category: 'Pizza', restaurant_id: restaurantId },
        { id: '3', name: 'Spaghetti Carbonara', price_cents: 2299, category: 'Pasta', restaurant_id: restaurantId },
        { id: '4', name: 'Schabowy z ziemniakami', price_cents: 1899, category: 'Dania główne', restaurant_id: restaurantId },
        { id: '5', name: 'Zupa pomidorowa', price_cents: 899, category: 'Zupy', restaurant_id: restaurantId }
      ];
      
      return res.json({
        fulfillment_response: {
          messages: [{ text: { text: ["Świetny wybór! Oto menu. Co podać?"] } }]
        },
        custom_payload: {
          menu_items: fallbackMenu
        },
      sessionInfo: {
        parameters: {
          // Dodaj mapę nazwa→ID pozycji menu dla create_order
          items_map: fallbackMenu.reduce((map, item) => {
            map[item.name] = item.id;
            return map;
          }, {})
        }
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
      },
      sessionInfo: {
        parameters: {
          // Dodaj mapę nazwa→ID pozycji menu dla create_order
          items_map: menuItems.reduce((map, item) => {
            map[item.name] = item.id;
            return map;
          }, {})
        }
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

async function diagMenuProbe(req, res) {
  try {
    const id = String(req.body?.sessionInfo?.parameters?.probe_id || "").trim().replace(/^"+|"+$/g, "");
    const { data, error } = await supabase
      .from("menu_items")
      .select("id,name,restaurant_id,price,price_cents")
      .eq("id", id)
      .single();
    return res.json({ ok: !!data, error: error?.message || null, item: data || null });
  } catch (e) {
    console.error("diagMenuProbe error:", e);
    return res.json({ ok: false, error: e.message, item: null });
  }
}

// --- DIAGNOSTIC ENDPOINT ---
export async function testSupabase(req, res) {
  console.log("🧪 [TEST] Checking Supabase connectivity...");
  try {
    const { data, error } = await supabase
      .from('menu_items')
      .select('id, name, price')
      .limit(1);

    if (error) throw error;
    return res.status(200).json({
      ok: true,
      message: "✅ Supabase connection works!",
      sample: data,
    });
  } catch (err) {
    console.error("❌ [TEST] Supabase error:", err.message);
    return res.status(500).json({
      ok: false,
      message: "❌ Supabase connection failed",
      error: err.message,
    });
  }
}

