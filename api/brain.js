import { supabase } from "../lib/supabaseClient.js";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export default async function handler(req, res) {
  try {
    const { text, userId } = req.body;
    if (!text) return res.status(400).json({ error: "Missing text" });

    // === 🔄 RESET KONTEKSTU ===
    const isNewQuery = /gdzie|co|jaka|które|blisko|pobliskie|chciałbym/i.test(text);
    const sessionId = isNewQuery ? `session_${Date.now()}` : "default";

    // === 🍽️ ROZPOZNANIE RESTAURACJI Z BAZY ===
    const { data: restaurants } = await supabase.from("restaurants").select("id, name");
    let foundRestaurant = null;

    if (restaurants && restaurants.length > 0) {
      foundRestaurant = restaurants.find(r =>
        text.toLowerCase().includes(r.name.toLowerCase())
      );
    }

    const restaurantContext = foundRestaurant
      ? foundRestaurant.name
      : "Monte Carlo";

    console.log("🧭 Active restaurant context:", restaurantContext);

    // === 💬 OPENAI RESPONSE ===
    const systemPrompt = `
      Jesteś Amber — asystentką FreeFlow. 
      Jeśli użytkownik mówi nazwę restauracji, przełącz kontekst.
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

    const reply = completion.choices[0].message.content;

    res.json({
      ok: true,
      reply,
      restaurantContext,
      sessionId,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("❌ Brain error:", error);
    res.status(500).json({ error: error.message });
  }
}