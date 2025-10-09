// /api/dialogflow-freeflow.js
import express from "express";
import { createClient } from "@supabase/supabase-js";

// --- 🧠 BEZPIECZNE ŁADOWANIE ENVÓW ---
const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL;

const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE ||
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_KEY ||
  process.env.SUPABASE_ANON_KEY;

// --- Walidacja środowiska ---
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Błąd konfiguracji Supabase:', {
    hasUrl: !!SUPABASE_URL,
    hasKey: !!SUPABASE_KEY,
  });
  throw new Error('Supabase credentials missing — backend zatrzymany.');
}

// --- Inicjalizacja Supabase ---
export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

console.log('✅ Supabase połączony:', {
  url: SUPABASE_URL?.replace(/https:\/\/|\.supabase\.co/g, ''),
  keyType: SUPABASE_KEY?.startsWith('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9') ? 'JWT' : 'Other',
});

const app = express();
app.use(express.json());

// --- Helper: send response to Dialogflow ---
const sendMessage = (res, text) =>
  res.json({
    fulfillment_response: {
      messages: [{ text: { text: [text] } }],
    },
  });

// --- Helper: UUID-safe validation ---
const isUUID = (id = "") => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);

// --- Helper: Text normalization for better matching ---
function normalize(text) {
  return text
    .toLowerCase()
    .replace(/[łŁ]/g, "l")
    .replace(/[ó]/g, "o")
    .replace(/[ś]/g, "s")
    .replace(/[żź]/g, "z")
    .replace(/[ć]/g, "c")
    .replace(/[ń]/g, "n")
    .replace(/\s+/g, " ")
    .trim();
}

// --- Helper: Find menu item with normalization ---
function findMenuItem(menu, query) {
  const normalizedQuery = normalize(query);
  return menu.find(item => normalize(item.name).includes(normalizedQuery));
}

// --- Helper: Parse quantity from user query ---
function parseQuantityAndQuery(userQuery) {
  let quantity = 1;
  let cleaned = userQuery;

  const match = userQuery.match(/(\d+)\s*x\s*(.+)/i);
  if (match) {
    quantity = parseInt(match[1]);
    cleaned = match[2];
  }

  return { quantity, cleaned };
}

// --- Main webhook handler ---
app.post('/api/dialogflow-freeflow', async (req, res) => {
  try {
    // Sprawdź czy Supabase jest skonfigurowany
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      return res.status(500).json({
        fulfillment_response: {
          messages: [{ text: { text: ["Brak konfiguracji Supabase. Sprawdź zmienne środowiskowe w Vercel."] } }],
        },
      });
    }

    const tag = req.body.fulfillmentInfo?.tag;
    const p = req.body.sessionInfo?.parameters || {}; // <-- wszystko tu jest

    console.log('🛰️ TAG:', tag);
    console.log('📦 PARAMS:', JSON.stringify(p, null, 2));

    if (tag === 'list_restaurants') {
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

    if (tag === 'select_restaurant') {
      const { restaurant_name, last_restaurant_list } = p;
      const found = Array.isArray(last_restaurant_list)
        ? last_restaurant_list.find(r => r.name?.toLowerCase() === restaurant_name?.toLowerCase())
        : null;

      return res.json({
        sessionInfo: { parameters: {
          restaurant_name_temp: found?.name || restaurant_name,
          restaurant_id: found?.id || p.restaurant_id || null, // zapisujemy na stałe
        } },
        fulfillment_response: { messages: [{ text: { text: [
          found ? `OK, wybieram ${found.name}.` : `Próbuję z ${restaurant_name}…`
        ] } }] }
      });
    }

    if (tag === 'get_menu') {
      let { restaurant_id, restaurant_name, last_restaurant_list } = p;

      // awaryjnie dopasuj ID po nazwie
      if (!restaurant_id && Array.isArray(last_restaurant_list)) {
        const f = last_restaurant_list.find(r => r.name?.toLowerCase() === restaurant_name?.toLowerCase());
        restaurant_id = f?.id || null;
      }

      if (!restaurant_id) {
        return res.json({ fulfillment_response: { messages: [{ text: { text: [
          'Nie mogę znaleźć tej restauracji. Powiedz nazwę jeszcze raz.'
        ] } }] } });
      }

      const { data, error } = await supabase
        .from("menu_items")
        .select("name, price")
        .eq("restaurant_id", restaurant_id);

      if (error) {
        console.error("❌ Błąd zapytania Supabase:", error);
        return sendMessage(res, "Wystąpił problem z pobraniem menu z bazy.");
      }

      if (!data?.length) return sendMessage(res, "Ta restauracja nie ma jeszcze dodanego menu.");

      const menuList = data.map((i) => `• ${i.name} — ${i.price} zł`).join("\n");
      return sendMessage(res, `Menu restauracji ${restaurant_name}:\n${menuList}`);
    }

    if (tag === 'create_order') {
      let { restaurant_id, restaurant_name, last_restaurant_list, dish, user_query } = p;

      // awaryjnie dopasuj ID po nazwie
      if (!restaurant_id && Array.isArray(last_restaurant_list)) {
        const f = last_restaurant_list.find(r => r.name?.toLowerCase() === restaurant_name?.toLowerCase());
        restaurant_id = f?.id || null;
      }

      if (!restaurant_id) {
        return res.json({ fulfillment_response: { messages: [{ text: { text: [
          'Nie mogę znaleźć tej restauracji. Wybierz restaurację z listy.'
        ] } }] } });
      }

      // Pobierz menu restauracji
      const { data: menu, error } = await supabase
        .from("menu_items")
        .select("id, name, price")
        .eq("restaurant_id", restaurant_id);

      if (error) {
        console.error("❌ Błąd zapytania menu:", error);
        return sendMessage(res, "Wystąpił problem z pobraniem menu z bazy.");
      }

      if (!menu?.length) {
        return sendMessage(res, "Ta restauracja nie ma jeszcze dodanego menu.");
      }

      // Użyj user_query jeśli dish nie jest dostępne
      const query = user_query || dish || '';
      
      if (!query) {
        return sendMessage(res, "Nie wiem co chcesz zamówić. Powiedz nazwę dania.");
      }

      // Parse quantity and clean query
      const { quantity, cleaned } = parseQuantityAndQuery(query);
      
      // Find menu item with normalization
      const item = findMenuItem(menu, cleaned);
      
      if (!item) {
        return sendMessage(res, `Nie znalazłem "${cleaned}" w menu. Spróbuj powiedzieć "pizza" lub "burger".`);
      }

      // Calculate total price
      const totalPrice = item.price * quantity;

      // Create order response
      const responseText = `Zamówienie przyjęte — ${quantity}x ${item.name} z ${restaurant_name}, razem ${totalPrice} zł. 🍕`;

      return res.json({
        fulfillment_response: {
          messages: [{ text: { text: [responseText] } }],
        },
        sessionInfo: {
          parameters: {
            ...p,
            menuItem: item.name,
            menuItemId: item.id,
            quantity: quantity,
            price: item.price,
            totalPrice: totalPrice
          }
        }
      });
    }

  // --- Dodawanie pozycji do menu (bez Dialogflow CX) ---
if (tag === 'add_menu_item') {
  try {
    const { restaurant_id, name, description, price } = p;

    if (!restaurant_id) {
      return sendMessage(res, "Nie mogę dodać dania — brak ID restauracji.");
    }

    if (!name || !price) {
      return sendMessage(res, "Podaj nazwę i cenę dania.");
    }

    const { data, error } = await supabase
      .from("menu_items")
      .insert([
        {
          restaurant_id,
          name,
          description: description || "",
          price,
          is_available: true, // dodajemy zgodnie z tabelą
        }
      ])
      .select();

    if (error) throw error;

    console.log("✅ Dodano pozycję do menu:", data[0]);
    return sendMessage(res, `Dodałem ${name} (${price} zł) do menu restauracji.`);
  } catch (err) {
    console.error("❌ Błąd podczas dodawania do menu:", err);
    return sendMessage(res, "Wystąpił błąd przy dodawaniu dania.");
  }
}

    return res.json({ fulfillment_response: { messages: [{ text: { text: ['Brak dopasowanego tagu.'] } }] } });

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