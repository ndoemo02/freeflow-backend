// /api/dialogflow-freeflow.js
import express from "express";
import { createClient } from "@supabase/supabase-js";

const app = express();
app.use(express.json());

// --- Supabase init ---
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_KEY
);

// --- główny router ---
app.post("/api/dialogflow-freeflow", async (req, res) => {
  try {
    const tag = req.body.fulfillmentInfo?.tag;
    const session = req.body.sessionInfo?.session;
    const params = req.body.sessionInfo?.parameters || {};

    console.log("🧭 TAG:", tag);

    switch (tag) {
      // =======================================================
      // 1️⃣ RECOMMEND_NEARBY — pobiera restauracje i tworzy encje sesyjne
      // =======================================================
      case "recommend_nearby": {
        const { data: restaurants } = await supabase
          .from("restaurants")
          .select("id, name, address")
          .limit(15);

        if (!restaurants || !restaurants.length)
          return res.json({
            fulfillment_response: {
              messages: [{ text: { text: ["Nie znalazłem restauracji w okolicy."] } }],
            },
          });

        // mapy pomocnicze
        const nameToId = Object.fromEntries(
          restaurants.map((r) => [r.name.toLowerCase(), r.id])
        );

        const listMsg =
          "Znalazłem te restauracje w okolicy:\n" +
          restaurants
            .map((r, i) => `${i + 1}) ${r.name} — ${r.address}`)
            .join("\n");

        // encje sesyjne
        const sessionEntities = [
          {
            name: `${session}/entityTypes/RestaurantName`,
            entityOverrideMode: "ENTITY_OVERRIDE_MODE_OVERRIDE",
            entities: restaurants.map((r) => ({
              value: r.name,
              synonyms: [r.name, r.name.toLowerCase()],
            })),
          },
        ];

        return res.json({
          fulfillment_response: { messages: [{ text: { text: [listMsg] } }] },
          custom_payload: { restaurants },
          sessionInfo: {
            parameters: {
              last_restaurant_list: restaurants,
              restaurant_name_to_id: nameToId,
              last_update_ts: Date.now() // tylko po to, żeby odświeżał sesję
            },
          },
          sessionEntityTypes: sessionEntities,
        });
      }

      // =======================================================
      // 2️⃣ SELECT_RESTAURANT — użytkownik podał nazwę lokalu
      // =======================================================
      case "select_restaurant": {
        const { restaurant_name, restaurant_name_to_id } = params || {};

        if (!restaurant_name_to_id || !restaurant_name) {
          console.warn("Brak mapy restauracji w sesji:", params);
          return res.json({
            fulfillment_response: {
              messages: [
                { text: { text: ["Nie udało się zidentyfikować restauracji."] } }
              ]
            }
          });
        }

        const restaurantId = restaurant_name_to_id[restaurant_name.toLowerCase()];
        console.log(`Wybrano: ${restaurant_name} → ${restaurantId}`);

        return res.json({
          sessionInfo: {
            parameters: { restaurant_id: restaurantId }
          },
          fulfillment_response: {
            messages: [
              { text: { text: [`Wybrano restaurację ${restaurant_name}.`] } }
            ]
          }
        });
      }

      // =======================================================
      // 3️⃣ GET_MENU — zwraca menu dla wybranej restauracji
      // =======================================================
      case "get_menu": {
        const restaurantId = params.restaurant_id;
        if (!restaurantId) {
          return res.json({
            fulfillment_response: {
              messages: [{ text: { text: ["Brak ID restauracji w sesji."] } }],
            },
          });
        }

        const { data: items } = await supabase
          .from("menu_items")
          .select("name, price")
          .eq("restaurant_id", restaurantId);

        if (!items || !items.length)
          return res.json({
            fulfillment_response: {
              messages: [{ text: { text: ["Menu jest puste lub niedostępne."] } }],
            },
          });

        const menuMsg =
          "Oto menu:\n" +
          items.map((i) => `• ${i.name} — ${i.price} zł`).join("\n");

        return res.json({
          fulfillment_response: { messages: [{ text: { text: [menuMsg] } }] },
        });
      }

      // =======================================================
      // 0️⃣ DEFAULT — brak tagu
      // =======================================================
      default:
        return res.json({
          fulfillment_response: {
            messages: [{ text: { text: ["Brak zdefiniowanej akcji dla tego tagu."] } }],
          },
        });
    }
  } catch (err) {
    console.error("❌ Błąd webhooka:", err);
    return res.status(500).json({
      fulfillment_response: {
        messages: [{ text: { text: ["Wystąpił błąd serwera webhooka."] } }],
      },
    });
  }
});

export default app;