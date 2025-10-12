import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import { getIntent } from "./intent-router.js";
import { getMemory, setMemory } from "./memory.js";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabase = createClient(
  process.env.SUPABASE_URL || 'https://ezemaacyyvbpjlagchds.supabase.co',
  process.env.SUPABASE_ANON_KEY || 'sb_publishable_-i5RiddgTH3Eh9-6xuJ7wQ_KjuredAu'
);

export default async function handler(req, res) {
  try {
    const { text, userId } = req.body;
    const memory = await getMemory(userId);
    const intent = await getIntent(text);
    let menuText = "";

    // 🍕 Jeśli użytkownik mówi o jedzeniu, sięgnij do bazy
    if (intent === "food") {
      const { data: restaurants } = await supabase
        .from("restaurants")
        .select("id, name")
        .ilike("name", `%${text}%`);

      if (restaurants?.length) {
        const { data: items } = await supabase
          .from("menu_items")
          .select("name, price_cents, description")
          .eq("restaurant_id", restaurants[0].id);

        if (items?.length) {
          menuText = `W ${restaurants[0].name} mamy:\n\n`;
          items.forEach(item => {
            const price = (item.price_cents / 100).toFixed(2);
            menuText += `• ${item.name} — ${price} zł\n`;
          });
        }
      }
    }

    // 🧠 Amber odpowiada na podstawie bazy lub kontekstu
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `
You are Amber — the FreeFlow voice. Be warm and natural.
If MENU data is available, refer to it gracefully.
Keep it short (1-2 sentences), Polish only.`
        },
        { role: "user", content: `INTENT: ${intent}` },
        { role: "user", content: `MEMORY: ${JSON.stringify(memory)}` },
        { role: "user", content: `USER: ${text}` },
        { role: "user", content: `MENU: ${menuText || "brak danych"}` }
      ],
      temperature: 0.8,
      max_tokens: 100
    });

    const reply = response.choices[0].message.content.trim();
    await setMemory(userId, { lastReply: reply, intent });
    res.json({ ok: true, reply, intent });
  } catch (err) {
    console.error("❌ Amber+Supabase error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
}
