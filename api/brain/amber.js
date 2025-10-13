// /api/brain/amber.js
import { supabase } from "../_supabase.js";

// --- helper: base URL ---
const BASE_URL =
  process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "https://freeflow-backend.vercel.app";

// --- intent keywords ---
const INTENTS = {
  pizza: "order_pizza",
  kebab: "order_kebab",
  piwo: "order_beer",
  restauracje: "find_restaurant",
};

// --- context endpoint sync ---
async function getContext() {
  try {
    const res = await fetch(`${BASE_URL}/api/brain/context`);
    return await res.json();
  } catch (err) {
    console.error("[Amber] context fetch failed:", err);
    return null;
  }
}

// --- intent detection ---
function detectIntent(text) {
  text = text.toLowerCase();
  for (const [word, intent] of Object.entries(INTENTS)) {
    if (text.includes(word)) return intent;
  }
  return "none";
}

// --- DB logging ---
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

    console.log("🧠 Amber Brain received:", phrase);

    // --- detect intent ---
    const intent = detectIntent(phrase);
    console.log("🤖 Intent detected:", intent);

    // --- context sync ---
    const context = await getContext();
    console.log("📡 Context:", context);

    let reply = "Nie jestem pewna, co masz na myśli — możesz powtórzyć?";
    if (intent === "order_pizza") reply = "Zamawiam pizzę — proszę potwierdzić rodzaj.";
    if (intent === "order_beer") reply = "Dwa piwa? Świetny wybór, zamówienie zapisane!";
    if (intent === "find_restaurant") reply = "Już szukam restauracji w okolicy 🍽️";

    // --- optional DB log ---
    if (intent.startsWith("order_")) {
      await logOrderToSupabase({ phrase, intent });
    }

    return res.status(200).json({
      ok: true,
      reply,
      intent,
      context,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Amber Brain fatal error:", error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}