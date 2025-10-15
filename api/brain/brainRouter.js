// /api/brain/brainRouter.js
import { detectIntent } from "./intent-router.js";
import { supabase } from "../_supabase.js";
import { getSession, updateSession } from "./context.js";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MODEL = "gpt-4o-mini";

/**
 * Główny router mózgu FreeFlow
 * 1) analizuje tekst
 * 2) kieruje do intencji / bazy
 * 3) generuje naturalną odpowiedź Amber
 */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const body = await req.json?.() || req.body || {};
    const { sessionId = "default", text } = body;
    if (!text) return res.status(400).json({ ok: false, error: "Missing text" });

    // 🔹 Pobierz kontekst sesji (pamięć krótkotrwała)
    const session = getSession(sessionId) || {};
    const prevRestaurant = session?.lastRestaurant;
    const prevIntent = session?.lastIntent;

    // 🔹 Krok 1: detekcja intencji i ewentualne dopasowanie restauracji
    const { intent, restaurant } = await detectIntent(text);

    // 🔹 Krok 2: zachowanie kontekstu
    updateSession(sessionId, {
      lastIntent: intent,
      lastRestaurant: restaurant || prevRestaurant || null,
      lastUpdated: Date.now(),
    });

    let dbResult = null;
    let replyCore = "";

    // 🔹 Krok 3: logika wysokopoziomowa
    switch (intent) {
      case "find_nearby": {
        const { data: restaurants, error } = await supabase
          .from("restaurants")
          .select("id,name,address,city")
          .limit(5);
        
        if (error) {
          console.error("❌ DB error:", error);
          replyCore = "Mam problem z bazą danych. Spróbuj ponownie za chwilę.";
          break;
        }
        
        if (!restaurants?.length) {
          replyCore = "Nie znalazłam jeszcze żadnej restauracji. Podaj nazwę lub wybierz z listy pobliskich lokali.";
          break;
        }
        
        // ✅ Użyj prawdziwych danych z bazy
        replyCore = `Oto ${restaurants.length} miejsc w pobliżu:\n` +
          restaurants.map((r, i) => 
            `${i+1}. ${r.name}${r.city ? ` (${r.city})` : ''}${r.address ? ` - ${r.address}` : ''}`
          ).join('\n') + 
          '\n\nKtóre miejsce Cię interesuje?';
        break;
      }

      case "menu_request": {
        // jeżeli w treści padła nazwa – spróbuj od razu ją ustawić
        const nameFromText = text.match(/(?:w|z)\s+restauracji\s+([A-Za-zĄąĆćĘęŁłŃńÓóŚśŹźŻż0-9\s\-]+)/i)?.[1]?.trim();

        // ⚠️ Walidacja nazw - tylko jeśli istnieje w bazie
        let verifiedRestaurant = null;
        if (nameFromText) {
          const { data: found, error } = await supabase
            .from("restaurants")
            .select("id,name,city,address")
            .ilike("name", `%${nameFromText}%`)
            .limit(3);

          if (!error && found?.length > 0) {
            verifiedRestaurant = found[0];
          } else {
            console.warn(`⚠️ Użytkownik podał nieznaną restaurację: "${nameFromText}"`);
          }
        }

        if (!verifiedRestaurant) {
          replyCore = `Nie znalazłam restauracji o nazwie "${nameFromText}". Możesz wybrać z tych, które są w pobliżu?`;
          break;
        }

        // Użyj zweryfikowanej restauracji lub ostatniej z sesji
        const current = verifiedRestaurant || getSession(sessionId)?.lastRestaurant;
        if (!current) { 
          replyCore = "Najpierw podaj nazwę restauracji."; 
          break; 
        }

        // Ustaw zweryfikowaną restaurację w sesji
        if (verifiedRestaurant) {
          updateSession(sessionId, { lastRestaurant: verifiedRestaurant });
        }

        const { data: menu, error } = await supabase
          .from("menu_items")
          .select("name, price, is_available")
          .eq("restaurant_id", current.id)
          .eq("is_available", true)
          .order("name", { ascending: true })
          .limit(6);

        if (error) { console.error("DB error:", error); replyCore = "Nie mogę teraz pobrać menu."; break; }

        if (!menu?.length) {
          replyCore = `W bazie nie ma pozycji menu dla ${current.name}. Mogę:
1) pokazać podobne lokale,
2) dodać szybki zestaw przykładowych pozycji do testów.
Co wybierasz?`;
          break;
        }

        replyCore = `W ${current.name} dostępne m.in.: ` +
          menu.map(m => `${m.name} (${Number(m.price).toFixed(2)} zł)`).join(", ") +
          ". Chcesz coś dodać do zamówienia?";
        break;
      }

      case "select_restaurant": {
        // wyciągnij nazwę z tekstu jeśli detectIntent nie dał obiektu
        const nameFromText = text.match(/restauracji\s+(.+)/i)?.[1]?.trim();
        const name = (restaurant?.name || nameFromText || "").trim();

        if (!name) { replyCore = "Podaj pełną nazwę restauracji."; break; }

        const { data: found, error } = await supabase
          .from("restaurants")
          .select("id,name,address,city")
          .ilike("name", `%${name}%`);

        if (error) { console.error("DB error:", error); replyCore = "Mam problem z bazą."; break; }

        if (!found?.length) {
          replyCore = `Nie znalazłam restauracji o nazwie „${name}”. Mogę zaproponować miejsca w pobliżu.`;
          break;
        }
        if (found.length > 1) {
          replyCore = `Którą masz na myśli: ${found.map(r => `${r.name} (${r.city||"?"})`).join(", ")}?`;
          break;
        }

        // ✅ dokładnie jedna – ustaw kontekst
        const r = found[0];
        updateSession(sessionId, { lastRestaurant: r });
        replyCore = replyCore || `Wybrano restaurację ${r.name}. Możemy przejść do menu albo od razu coś zamówić.`;
        break;
      }

      case "create_order": {
        const current = getSession(sessionId)?.lastRestaurant;
        if (!current) {
          replyCore = "Najpierw wybierz restaurację, zanim złożysz zamówienie.";
          break;
        }

        // przykładowe dane — do dopracowania
        const { data, error } = await fetch("http://localhost:3000/api/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId,
            restaurant_id: current.id,
            items: [{ name: "Pizza Margherita", qty: 1 }],
          }),
        }).then(r => r.json());

        if (error) {
          replyCore = "Nie udało się utworzyć zamówienia 😕 Spróbuj ponownie.";
        } else {
          replyCore = `Zamówienie #${data?.id || "nowe"} przyjęte! 🍕`;
        }
        break;
      }

      default:
        replyCore = "Nie jestem pewna, co masz na myśli — możesz powtórzyć?";
        break;
    }

    // 🔹 Krok 4: Generacja odpowiedzi Amber (stylistyczna)
    const tone = session?.tone || "neutralny";
    const amberCompletion = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      // ⬇️ dodaj timeout i parametry zwiększające szansę na pełny zwrot
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.7,
        max_tokens: 300, // zwiększ limity generacji
        presence_penalty: 0.2,
        frequency_penalty: 0.2,
        messages: [
          {
            role: "system",
            content: `Jesteś Amber — asystentką FreeFlow. Mów po polsku, krótko i naturalnie, ale dokończ pełną myśl.`,
          },
          { role: "user", content: replyCore },
        ],
      }),
    });

    const amberData = await amberCompletion.json();
    const reply =
      amberData.choices?.[0]?.message?.content?.trim() ||
      replyCore ||
      "Nie mam teraz odpowiedzi.";

    // --- Anty-bullshit watchdog (cicha wersja prod-safe) ---
    const sanitizedReply = (reply || "").trim();
    const isBrokenReply =
      !sanitizedReply ||
      sanitizedReply.length < 12 ||
      /(tak, chętnie|oczywiście|świetny wybór|z przyjemnością|miło mi|nie jestem pewna)/i.test(sanitizedReply);

    if (isBrokenReply) {
      console.warn("⚠️ Amber zwróciła pustą lub podejrzaną odpowiedź:", sanitizedReply);

      if (!res.headersSent) {
        return res.status(200).json({
          ok: true,
          intent: intent || "none",
          restaurant: restaurant || prevRestaurant || null,
          reply: null, // 🔇 brak odpowiedzi dla UI
          context: getSession(sessionId),
          timestamp: new Date().toISOString(),
        });
      }

      console.warn("⚠️ Headers already sent – watchdog only logged.");
    }

    // 🔹 Krok 5: finalna odpowiedź
    return res.status(200).json({
      ok: true,
      intent,
      restaurant: restaurant || prevRestaurant || null,
      reply,
      context: getSession(sessionId),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("🧠 brainRouter error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
