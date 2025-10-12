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
      .select("id, name, address");

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
    
    // TODO: W przyszłości można dodać współrzędne do tabeli restaurants
    // i wtedy używać sortowania po odległości
    console.log("📍 Restaurants loaded:", restaurants?.length || 0, "items");

    let foundRestaurant = null;
    if (sortedRestaurants && sortedRestaurants.length > 0) {
      foundRestaurant = sortedRestaurants.find(r =>
        text.toLowerCase().includes(r.name.toLowerCase())
      );
    }

    const restaurantContext = foundRestaurant ? foundRestaurant.name : "Monte Carlo";
    console.log("🧭 Active restaurant context:", restaurantContext);

    // === OPENAI ===
    const systemPrompt = `
      Jesteś Amber — asystentką FreeFlow.
      Jeśli użytkownik wspomina nazwę restauracji, przełącz kontekst.
      Jeśli nie mówi żadnej nazwy, zaproponuj kilka z listy.
      Aktualna restauracja: ${restaurantContext}.
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