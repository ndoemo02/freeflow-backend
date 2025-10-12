import { supabase } from "../lib/supabaseClient.js";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export default async function handler(req, res) {
  try {
    const { text, userId } = req.body || {};
    if (!text) return res.status(400).json({ error: "Missing text" });

    // ✅ Log startowy
    console.log("🧠 Brain received:", text);

    // === RESET SESJI ===
    const isNewQuery = /gdzie|co|jaka|które|blisko|pobliskie|chciałbym/i.test(text);
    const sessionId = isNewQuery ? `session_${Date.now()}` : "default";

    // === POBIERZ RESTAURACJE ===
    const { data: restaurants, error: dbError } = await supabase
      .from("restaurants")
      .select("id, name, address, lat, lng");

    if (dbError) {
      console.error("❌ Supabase error:", dbError.message);
      return res.status(500).json({ error: "Błąd połączenia z bazą" });
    }

    // --- sortowanie restauracji po odległości ---
    function distance(lat1, lon1, lat2, lon2) {
      const R = 6371; // km
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) *
        Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    let sortedRestaurants = restaurants;
    
    // --- sortowanie restauracji po odległości ---
    if (req.body.lat && req.body.lng && restaurants && restaurants.length > 0) {
      const { lat, lng } = req.body;
      
      // Sprawdź czy pierwsza restauracja ma współrzędne
      const hasCoordinates = restaurants[0] && (restaurants[0].lat !== null && restaurants[0].lat !== undefined);
      
      if (hasCoordinates) {
        sortedRestaurants = restaurants
          .map(r => ({
            ...r,
            distance: r.lat && r.lng ? distance(lat, lng, r.lat, r.lng) : null
          }))
          .sort((a, b) => (a.distance ?? 999) - (b.distance ?? 999));
        
        console.log("📍 Sorted restaurants by distance:", sortedRestaurants.map(r => ({ name: r.name, distance: r.distance?.toFixed(2) + " km" })));
      } else {
        console.log("📍 No coordinates available, using original order");
      }
    }
    
    console.log("📍 Restaurants loaded:", restaurants?.length || 0, "items");

    let foundRestaurant = null;
    if (sortedRestaurants && sortedRestaurants.length > 0) {
      foundRestaurant = sortedRestaurants.find(r =>
        text.toLowerCase().includes(r.name.toLowerCase())
      );
    }

    const restaurantContext = foundRestaurant ? foundRestaurant.name : "Monte Carlo";
    console.log("🧭 Active restaurant context:", restaurantContext);

    // === GENERUJ LISTĘ RESTAURACJI ===
    const restaurantList = sortedRestaurants
      .slice(0, 5)
      .map((r, i) => `${i + 1}. ${r.name}${r.distance ? ` (${r.distance.toFixed(1)} km)` : ''}`)
      .join("\n");

    // === OPENAI ===
    const systemPrompt = `
      Jesteś Amber — asystentką FreeFlow.
      Jeśli użytkownik wspomina nazwę restauracji, przełącz kontekst.
      Jeśli nie mówi żadnej nazwy, zaproponuj kilka z listy.
      Aktualna restauracja: ${restaurantContext}.
      
      Dostępne restauracje:
      ${restaurantList}
    `;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: text }
      ],
      temperature: 0.8,
      max_tokens: 150
    });

    const reply = completion?.choices?.[0]?.message?.content || "Nie mogę teraz odpowiedzieć.";
    res.json({
      ok: true,
      reply,
      restaurantContext,
      sessionId,
      restaurants: sortedRestaurants,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error("❌ Brain fatal error:", error);
    res.status(500).json({ error: error.message || "Błąd serwera Brain" });
  }
}