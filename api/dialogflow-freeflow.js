// /api/dialogflow-freeflow.js
import express from "express";
import { createClient } from "@supabase/supabase-js";

const app = express();
app.use(express.json());

// --- Supabase init ---
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// --- Helper: send response to Dialogflow ---
const sendMessage = (res, text) =>
  res.json({
    fulfillment_response: {
      messages: [{ text: { text: [text] } }],
    },
  });

// --- Helper: UUID-safe validation ---
const isUUID = (id = "") => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);

// --- Main webhook handler ---
app.post("/api/dialogflow-freeflow", async (req, res) => {
  try {
    const tag = req.body.fulfillmentInfo?.tag;
    const params = req.body.sessionInfo?.parameters || {};
    console.log("🛰️ Webhook tag:", tag);
    console.log("📦 Params:", JSON.stringify(params, null, 2));

    // 1️⃣ ListRestaurants
    if (tag === "list_restaurants") {
      const { data, error } = await supabase.from("restaurants").select("id, name, address");
      if (error) throw error;

      const listText = data
        .map((r, i) => `${i + 1}) ${r.name} — ${r.address}`)
        .join("\n");

      return res.json({
        sessionInfo: { parameters: { last_restaurant_list: data } },
        fulfillment_response: {
          messages: [{ text: { text: [`Znalazłem te restauracje:\n${listText}`] } }],
        },
      });
    }

    // 2️⃣ ShowMenu
    if (tag === "show_menu") {
      const { restaurant_name, restaurant_id, last_restaurant_list } = params;

      // Dopasowanie ID po nazwie, jeśli brak
      let id = restaurant_id;
      if (!id && Array.isArray(last_restaurant_list)) {
        const found = last_restaurant_list.find(
          (r) => r.name.toLowerCase() === restaurant_name?.toLowerCase()
        );
        id = found?.id;
      }

      if (!id || !isUUID(id)) {
        console.warn("⚠️ Niepoprawny restaurant_id:", id);
        return sendMessage(res, "Nie mogę znaleźć tej restauracji w bazie.");
      }

      const { data, error } = await supabase
        .from("menu_items")
        .select("name, price")
        .eq("restaurant_id", id);

      if (error) {
        console.error("❌ Błąd zapytania Supabase:", error);
        return sendMessage(res, "Wystąpił problem z pobraniem menu z bazy.");
      }

      if (!data?.length) return sendMessage(res, "Ta restauracja nie ma jeszcze dodanego menu.");

      const menuList = data.map((i) => `• ${i.name} — ${i.price} zł`).join("\n");
      return sendMessage(res, `Menu restauracji ${restaurant_name}:\n${menuList}`);
    }

    // 3️⃣ Default fallback
    return sendMessage(res, "Nie rozumiem zapytania (brak dopasowanego tagu).");

  } catch (err) {
    console.error("💥 Błąd webhooka:", err);
    return res.status(500).json({
      fulfillment_response: {
        messages: [{ text: { text: ["Wystąpił błąd po stronie serwera."] } }],
      },
    });
  }
});

// --- Export handler (Vercel) ---
export default app;