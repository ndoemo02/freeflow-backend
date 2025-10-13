// /api/brain/amber.js
import { supabase } from "../_supabase.js";
import { detectIntent, trainIntent } from './intent-router.js';
import { saveContext, getContext, clearContext } from './memory.js';
import { applyCORS } from '../_cors.js';
// import personality from './personality.json' assert { type: 'json' };
const personality = { name: "Amber", tone: "warm", language: "pl-PL" };

const BASE_URL =
  process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : process.env.NODE_ENV === 'development' 
      ? "http://localhost:3000"
      : "https://freeflow-backend.vercel.app";

// Usunięto - używamy intent-router.js

// Usunięto - używamy memory.js

// --- calculate distance ---
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // promień Ziemi w km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// --- get restaurants ---
async function getRestaurants(userLat, userLng) {
  try {
    console.log(`[Amber] Fetching restaurants from Supabase`);
    const { data, error } = await supabase
      .from("restaurants")
      .select("id, name, address, lat, lng");
    
    if (error) {
      console.error("[Amber] Supabase error:", error);
      return [];
    }
    
    console.log(`[Amber] Received ${data?.length || 0} restaurants from Supabase`);
    
    if (!data || data.length === 0) {
      console.log(`[Amber] No restaurants found in database`);
      return [];
    }
    
    // Jeśli mamy współrzędne użytkownika, oblicz odległości
    if (userLat && userLng) {
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

// Usunięto - używamy intent-router.js

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
  if (applyCORS(req, res)) return; // 👈 CORS handling

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

    // Użyj zaawansowanego rozpoznawania intencji
    const intentResult = await detectIntent(phrase);
    console.log("🤖 Detected intent:", intentResult);

    const context = getContext();

    let reply = "Nie jestem pewna, co masz na myśli — możesz powtórzyć?";
    let restaurantsList = [];

    // --- RESTAURANT FLOW ---
    if (intentResult.intent === "find_nearby") {
      console.log(`[Amber] Processing find_nearby intent`);
      restaurantsList = await getRestaurants(lat, lng);
      console.log(`[Amber] Found ${restaurantsList.length} restaurants`);
      
      if (restaurantsList.length > 0) {
        // Weź 3 najbliższe restauracje
        const nearby = restaurantsList.slice(0, 3);
        console.log(`[Amber] Selected ${nearby.length} nearby restaurants:`, nearby.map(r => r.name));
        
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
        saveContext('find_nearby');
      } else {
        console.log(`[Amber] No restaurants found - returning fallback message`);
        reply = "Nie znalazłam żadnych restauracji w pobliżu.";
      }
    }

    // --- SELECT RESTAURANT FLOW ---
    if (intentResult.intent === "select_restaurant" && intentResult.restaurant) {
      const restaurant = intentResult.restaurant;
      reply = `Świetny wybór! ${restaurant.name} znajduje się przy ${restaurant.address}. Chcesz zobaczyć menu?`;
      saveContext('select_restaurant', restaurant);
    }

    // --- ORDER FLOW ---
    if (phrase.toLowerCase().includes('pizza') || phrase.toLowerCase().includes('kebab') || phrase.toLowerCase().includes('piwo')) {
      await logOrderToSupabase({ phrase, intent: 'order' });
      reply = `Zapisuję zamówienie: ${phrase}`;
    }

    return res.status(200).json({
      ok: true,
      reply,
      intent: intentResult.intent,
      restaurant: intentResult.restaurant,
      context,
      restaurants: restaurantsList,
      personality: personality.name,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Amber Brain fatal error:", error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}