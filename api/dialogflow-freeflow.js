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

// 🧩 Funkcja inteligentnego dopasowania nazw dań
function normalizeDishName(dish = "") {
  if (!dish) return "";
  const lower = dish.toLowerCase();

  // 🔹 Standardowe uproszczenia i aliasy
  const replacements = {
    "hawajska": "pizza hawajska",
    "hawajską": "pizza hawajska",
    "margherita": "pizza margherita",
    "margerita": "pizza margherita",
    "peperoni": "pizza pepperoni",
    "pepperoni": "pizza pepperoni",
    "capriciosa": "pizza capricciosa",
    "capricciosa": "pizza capricciosa",
    "kebab box": "kebab box",
    "kebab": "kebab",
    "burger": "hamburger",
    "frytki": "frytki",
    "cola": "cola",
    "napój": "napój",
  };

  // Znajdź dopasowanie częściowe
  for (const [key, value] of Object.entries(replacements)) {
    if (lower.includes(key)) return value;
  }

  return dish;
}

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
      // 1.5️⃣ LIST_RESTAURANTS — lista restauracji z zapamiętaniem w sesji
      // =======================================================
      case "list_restaurants": {
        const { data: restaurants } = await supabase
          .from("restaurants")
          .select("id, name")
          .limit(15);

        if (!restaurants || !restaurants.length) {
          return res.json({
            fulfillment_response: {
              messages: [{ text: { text: ["Nie znalazłem restauracji w okolicy."] } }],
            },
          });
        }

        const list = restaurants.map((r) => ({
          id: r.id,
          name: r.name,
        }));

        const responseText =
          "Znalazłem te restauracje w okolicy:\n" +
          list.map((r, i) => `${i + 1}) ${r.name}`).join("\n");

        return res.json({
          fulfillment_response: { messages: [{ text: { text: [responseText] } }] },
          sessionInfo: {
            parameters: {
              last_restaurant_list: list,
            },
          },
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

        let restaurantId = null;

        // Najpierw sprawdź zapamiętaną listę z sesji
        const lastRestaurantList = params.last_restaurant_list;
        if (lastRestaurantList && Array.isArray(lastRestaurantList)) {
          const foundRestaurant = lastRestaurantList.find(r => 
            r.name.toLowerCase() === restaurantName?.toLowerCase()
          );
          if (foundRestaurant) {
            restaurantId = foundRestaurant.id;
            console.log(`✅ Znaleziono w sesji: ${restaurantName} → ${restaurantId}`);
          }
        }

        // Jeśli nie znaleziono w sesji, użyj hardcoded mapy jako fallback
        if (!restaurantId) {
          const restaurantMap = {
            'callzone': 'bd9f2244-7618-4071-aa96-52616a7b4c70',
            'bar praha': '8b00b05e-72f7-4a5f-b50c-5630a75d6312',
            'tasty king kebab': 'fc844513-2869-4f42-b04f-c21e1e4cceb7',
            'restauracja stara kamienica': '1fc1e782-bac6-47b2-978a-f6f2b38000cd',
            'dwór hubertus': 'af8448ef-974b-46c8-a4ae-b04b8dc7c9f8',
            'restauracja rezydencja': '4d27fbe3-20d0-4eb4-b003-1935be53af25',
            'vien-thien': '70842598-1632-43f6-8015-706d5adf182f',
            'pizzeria monte carlo': '83566974-1017-4408-90ee-2571cc069878',
            'burger house': '569a7d29-57be-4224-bdf3-09c483415cea'
          };

          restaurantId = restaurantMap[restaurantName?.toLowerCase()];
          if (restaurantId) {
            console.log(`✅ Znaleziono w mapie: ${restaurantName} → ${restaurantId}`);
          }
        }

        if (!restaurantId) {
          console.log('⚠️ Brak ID dla:', restaurantName);
          return res.json({
            fulfillment_response: {
              messages: [{ text: { text: ["Nie udało się znaleźć tej restauracji, bajtlu!"] } }]
            }
          });
        }

        console.log(`✅ Wybrano: ${restaurantName} → ${restaurantId}`);
        return res.json({
          fulfillment_response: {
            messages: [{ text: { text: [`Wybrano restaurację ${restaurantName}. Co chcesz zamówić?`] } }]
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
      // 2.5️⃣ CREATE_ORDER — tworzy zamówienie
      // =======================================================
      case "create_order": {
        const parameters = {
          ...req.body.sessionInfo?.parameters,
          ...req.body.intentInfo?.parameters,
        };

        console.log("🧾 DEBUG | parameters =", JSON.stringify(parameters, null, 2));

        const restaurant_id =
          req.body.sessionInfo?.parameters?.restaurant_id ||
          req.body.sessionInfo?.parameters?.Restaurant_id ||
          req.body.fulfillmentInfo?.tag === "get_menu" ? req.body.sessionInfo?.parameters?.restaurant_id : null;

        console.log("🧭 DEBUG restaurantId:", restaurant_id);
        const dishRaw = parameters.dish?.resolvedValue || parameters.dish;
        const dish = normalizeDishName(dishRaw);
        const qty = parameters.qty?.resolvedValue || parameters.qty || 1;
        const size = parameters.size?.resolvedValue || parameters.size || "";

        // Walidacja danych
        if (!restaurant_id || !dish) {
          return res.json({
            fulfillment_response: {
              messages: [
                { text: { text: ["Nie mogę złożyć zamówienia — brakuje danych restauracji lub dania."] } },
              ],
            },
          });
        }

        // Pobierz nazwę restauracji
        const { data: restaurant } = await supabase
          .from("restaurants")
          .select("name")
          .eq("id", restaurant_id)
          .single();

        // Szukamy dania w menu
        const { data: menuItem } = await supabase
          .from("menu_items")
          .select("name, price")
          .eq("restaurant_id", restaurant_id)
          .ilike("name", `%${dish}%`)
          .single();

        if (!menuItem) {
          return res.json({
            fulfillment_response: {
              messages: [
                { text: { text: [`Nie znalazłem dania ${dish} w menu restauracji ${restaurant?.name || "nieznanej"}.`] } },
              ],
            },
          });
        }

        // Obliczenia i odpowiedź
        const totalPrice = menuItem.price * qty;
        const responseText = `Zamówienie przyjęte — ${qty}x ${dish} ${size ? size + " " : ""}z ${restaurant?.name || "nieznanej restauracji"}, razem ${totalPrice} zł. 🍕`;

        return res.json({
          fulfillment_response: {
            messages: [{ text: { text: [responseText] } }],
          },
        });
      }

      // =======================================================
      // 3️⃣ GET_MENU — zwraca menu dla wybranej restauracji
      // =======================================================
      case "get_menu": {
        // --- FIX: Fallback na przypadek, gdy Dialogflow zgubi restaurant_id
        let restaurantId = parameters.restaurant_id;

        if (!restaurantId && parameters.restaurant_name) {
          console.log("⚠️ Brak restaurant_id, próbuję znaleźć po nazwie:", parameters.restaurant_name);

          // fallback: wyszukaj po nazwie (np. Callzone)
          const { data: found, error: findErr } = await supabase
            .from('restaurants')
            .select('id')
            .ilike('name', `%${parameters.restaurant_name}%`)
            .maybeSingle();

          if (found?.id) {
            restaurantId = found.id;
            console.log("✅ Odzyskano ID restauracji:", restaurantId);
          } else {
            console.log("❌ Nie udało się odzyskać ID restauracji:", findErr);
          }
        }

        if (!restaurantId) {
          return res.json({
            fulfillment_response: {
              messages: [{
                text: {
                  text: [
                    "Nie udało się znaleźć tej restauracji, bajtlu! Brak ID w sesji i nie znaleziono po nazwie."
                  ]
                }
              }]
            }
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