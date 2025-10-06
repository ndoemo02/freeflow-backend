// /api/dialogflow-freeflow.ts
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

export default async function handler(req, res) {
  const { fulfillmentInfo, sessionInfo } = req.body || {};
  const tag = fulfillmentInfo?.tag;
  
  console.log('🚀 WEBHOOK HIT - tag:', tag, 'body:', JSON.stringify(req.body, null, 2));

  try {
    if (tag === "list_restaurants") return await listRestaurants(req, res);
    if (tag === "list_menu") return await listMenu(req, res);
    if (tag === "create_order") return await createOrder(req, res);
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
  console.log('🔍 LIST RESTAURANTS - city:', JSON.stringify(city));
  console.log('🔍 LIST RESTAURANTS - city length:', city.length);
  
  // Test 1: Sprawdź czy w ogóle mamy dane
  const { data: allData, error: allError } = await supabase.from("restaurants").select("id,name,address,city").limit(3);
  console.log('🔍 LIST RESTAURANTS - all data test:', { allData, allError });
  
  // Test 2: Sprawdź czy ILIKE działa
  const { data, error } = await supabase.from("restaurants").select("id,name,address").ilike("city", `%${city}%`);
  console.log('🔍 LIST RESTAURANTS - query result:', { data, error });
  
  const lines = (data||[]).map((r, i) => `${i+1}) ${r.name} — ${r.address}`).join("\n");

  // mapka numer→id do późniejszego wyboru
  const options_map = {};
  (data||[]).forEach((r, i) => options_map[String(i+1)] = { restaurant_id: r.id });

  return res.json({
    sessionInfo: { parameters: { options_map } },
    fulfillment_response: { messages: [{ text: { text: [lines || "Nie znaleziono lokali."] } }] }
  });
}

async function listMenu(req, res) {
  const p = req.body?.sessionInfo?.parameters || {};
  // użytkownik mógł wskazać numer z listy
  const selected = p?.selection && p?.options_map?.[p.selection];
  const restaurant_id = p.restaurant_id || selected?.restaurant_id;

  const dish = p.dish; // np. "capricciosa"
  const { data } = await supabase
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

  const { data: item } = await supabase.from("menu_items")
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
