// /api/brain/amber.js
import { supabase } from "../_supabase.js";

const BASE_URL =
  process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : process.env.NODE_ENV === 'development' 
      ? "http://localhost:3000"
      : "https://freeflow-backend.vercel.app";

const INTENTS = {
  pizza: "order_pizza",
  kebab: "order_kebab",
  piwo: "order_beer",
  restauracja: "find_restaurant",
  restauracje: "find_restaurant",
  knajpa: "find_restaurant",
  bar: "find_restaurant",
  jedzenie: "find_restaurant",
  zjem: "find_restaurant",
  zjeść: "find_restaurant",
  zjesc: "find_restaurant",
  gdzie: "find_restaurant",
  mogę: "find_restaurant",
  moge: "find_restaurant",
  pobliżu: "find_restaurant",
  pobliż: "find_restaurant",
  okolicy: "find_restaurant",
  blisko: "find_restaurant",
  obok: "find_restaurant",
  polecasz: "find_restaurant",
  polecacie: "find_restaurant",
  smaczne: "find_restaurant",
  dobre: "find_restaurant",
  dobra: "find_restaurant",
};

// --- get context
async function getContext() {
  try {
    // Zwróć prosty kontekst zamiast fetch do siebie
    return {
      lastRestaurant: null,
      lastIntent: null,
      lastUpdated: new Date().toISOString()
    };
  } catch (err) {
    console.error("[Amber] context fetch failed:", err);
    return null;
  }
}

// --- calculate distance ---
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Radius of the Earth in kilometers
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// --- get restaurants ---
async function getRestaurants(userLat, userLng) {
  try {
    // Bezpośrednie zapytanie do Supabase zamiast fetch do siebie
    console.log(`[Amber] Fetching restaurants directly from Supabase`);
    const { data, error } = await supabase
      .from("restaurants")
      .select("id, name, address, lat, lng");
    
    if (error) {
      console.error("[Amber] Supabase error:", error);
      return [];
    }
    
    console.log(`[Amber] Received ${data?.length || 0} restaurants from Supabase`);
    
    // Jeśli mamy współrzędne użytkownika, oblicz odległości
    if (userLat && userLng && data) {
      const restaurantsWithDistance = data.map(restaurant => ({
        ...restaurant,
        distance_km: calculateDistance(userLat, userLng, restaurant.lat, restaurant.lng)
      }));
      
      // Sortuj według odległości
      restaurantsWithDistance.sort((a, b) => a.distance_km - b.distance_km);
      console.log(`[Amber] Sorted restaurants by distance`);
      return restaurantsWithDistance;
    }
    
    return data || [];
  } catch (err) {
    console.error("[Amber] restaurants fetch failed:", err);
    return [];
  }
}

// --- detect intent ---
function detectIntent(text) {
  text = text.toLowerCase();
  
  // Sprawdź frazy wielowyrazowe
  const phrases = [
    "gdzie mogę zjeść",
    "gdzie moge zjesc", 
    "restauracje w pobliżu",
    "restauracje w poblizu",
    "co polecasz do jedzenia",
    "gdzie jest dobre jedzenie",
    "gdzie zjeść w okolicy",
    "gdzie zjesc w okolicy",
    "co jest smaczne",
    "gdzie jest blisko",
    "restauracja w pobliżu",
    "restauracja w poblizu"
  ];
  
  for (const phrase of phrases) {
    if (text.includes(phrase)) return "find_restaurant";
  }
  
  // Sprawdź pojedyncze słowa
  for (const [word, intent] of Object.entries(INTENTS)) {
    if (text.includes(word)) return intent;
  }
  
  return "none";
}

// --- log order ---
async function logOrderToSupabase({ phrase, intent }) {
  try {
    const { data, error } = await supabase
      .from("orders")
      .insert([
        {
          customer_name: "Anonymous",
          order_details: phrase,
          status: "pending",
          created_at: new Date().toISOString(),
        },
      ])
      .select();
    if (error) throw error;
    console.log("[Amber] ✅ Order logged:", data[0]);
    return data[0];
  } catch (error) {
    console.error("[Amber] ❌ Supabase insert error:", error.message);
    return null;
  }
}

// --- handler ---
export default async function handler(req, res) {
  try {
    if (req.method !== "POST")
      return res.status(405).json({ ok: false, error: "Method not allowed" });

    const body = await req.json?.() ?? req.body;
    const phrase = body?.text || body?.phrase || "";
    const lat = body?.lat;
    const lng = body?.lng;

    console.log("🧠 Amber Brain received:", phrase);
    if (lat && lng) {
      console.log(`📍 Location: ${lat}, ${lng}`);
    }

    const intent = detectIntent(phrase);
    console.log("🤖 Detected intent:", intent);

    const context = await getContext();

    let reply = "Nie jestem pewna, co masz na myśli — możesz powtórzyć?";
    let restaurantsList = [];

    // --- RESTAURANT FLOW ---
    if (intent === "find_restaurant") {
      restaurantsList = await getRestaurants(lat, lng);
      if (restaurantsList.length > 0) {
        // Weź 3 najbliższe restauracje
        const nearby = restaurantsList.slice(0, 3);
        
        if (lat && lng) {
          // Z odległościami
          const withDistances = nearby.map(r => {
            const dist = r.distance_km < 1 
              ? `${Math.round(r.distance_km * 1000)} metrów` 
              : `${r.distance_km.toFixed(1)} km`;
            return `${r.name} (${dist})`;
          }).join(", ");
          reply = `W pobliżu możesz zjeść w: ${withDistances}.`;
        } else {
          // Bez odległości
          const names = nearby.map(r => r.name).join(", ");
          reply = `W pobliżu możesz zjeść w: ${names}.`;
        }
      } else {
        reply = "Nie znalazłam żadnych restauracji w pobliżu.";
      }
    }

    // --- ORDER FLOW ---
    if (intent.startsWith("order_")) {
      await logOrderToSupabase({ phrase, intent });
      reply = `Zapisuję zamówienie: ${phrase}`;
    }

    return res.status(200).json({
      ok: true,
      reply,
      intent,
      context,
      restaurants: restaurantsList,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Amber Brain fatal error:", error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}