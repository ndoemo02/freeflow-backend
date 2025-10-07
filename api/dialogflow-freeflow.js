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
    console.log('💡 BODY =', JSON.stringify(req.body, null, 2));
    
    const tag = req.body.fulfillmentInfo?.tag;
    const session = req.body.sessionInfo?.session;
    const params = req.body.sessionInfo?.parameters || {};

    console.log("🧭 TAG:", tag);
    console.log('🧩 DEBUG: parameters =', JSON.stringify(req.body.sessionInfo?.parameters, null, 2));

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
              last_restaurant_list: restaurants.map(r => r.name),
              restaurant_name_to_id: JSON.stringify(nameToId).replace(/\\/g, '\\\\').replace(/"/g, '\\"'), // 👈 podwójne escapowanie
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
        console.log('🧩 DEBUG: req.body.sessionInfo =', JSON.stringify(req.body.sessionInfo, null, 2));
        const params = req.body.sessionInfo?.parameters || {};
        const restaurantName = params.RestaurantName || params.restaurantName || params.restaurant_name;

        console.log('🍽 Wybrana restauracja =', restaurantName);

        const restaurantMap = {
          'Callzone': 'bd9f2244-7618-4071-aa96-52616a7b4c70',
          'Bar Praha': '8b00b05e-72f7-4a5f-b50c-5630a75d6312',
          'Tasty King Kebab': 'fc844513-2869-4f42-b04f-c21e1e4cceb7',
          'Restauracja Stara Kamienica': '1fc1e782-bac6-47b2-978a-f6f2b38000cd',
          'Dwór Hubertus': 'af8448ef-974b-46c8-a4ae-b04b8dc7c9f8',
          'Restauracja Rezydencja': '4d27fbe3-20d0-4eb4-b003-1935be53af25',
          'Vien-Thien': '70842598-1632-43f6-8015-706d5adf182f',
          'Pizzeria Monte Carlo': '83566974-1017-4408-90ee-2571cc069878',
          'Burger House': '569a7d29-57be-4224-bdf3-09c483415cea'
        };

        const restaurantId = restaurantMap[restaurantName];

        if (!restaurantId) {
          console.log('⚠️ Brak ID w mapie dla:', restaurantName);
          return res.json({
            fulfillment_response: {
              messages: [{ text: { text: [`Nie udało się zidentyfikować restauracji "${restaurantName}".`] } }]
            }
          });
        }

        console.log(`✅ Wybrano: ${restaurantName} → ${restaurantId}`);
        return res.json({
          fulfillment_response: {
            messages: [{ text: { text: [`Wybrano restaurację ${restaurantName}.`] } }]
          },
          sessionInfo: {
            parameters: {
              restaurant_id: restaurantId,
              restaurant_name: restaurantName
            }
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