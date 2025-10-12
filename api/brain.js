import OpenAI from "openai";
import { slangMap } from "../utils/slangMap.js";
import { SYSTEM_PROMPT } from "../core/amberPrompt.js";
import { sessions } from "../core/sessionStore.js";
import supabase from "@supabase/supabase-js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// 🧭 Fuzzy dopasowanie nazw restauracji
const restaurantAliases = {
  "monte": "Pizzeria Monte Carlo",
  "montecarlo": "Pizzeria Monte Carlo",
  "pizzerii monte carlo": "Pizzeria Monte Carlo",
  "pizzerii monte": "Pizzeria Monte Carlo",
  "king": "Tasty King Kebab",
  "king kebab": "Tasty King Kebab",
  "praga": "Bar Praha",
  "rezydencja": "Restauracja Rezydencja",
};

function resolveRestaurantName(text) {
  const lower = text.toLowerCase();
  for (const [alias, canonical] of Object.entries(restaurantAliases)) {
    if (lower.includes(alias)) return canonical;
  }
  return null;
}

// 🧹 Normalizacja tekstu użytkownika
function normalizeInput(text) {
  let cleaned = text.toLowerCase();
  for (const [slang, proper] of Object.entries(slangMap)) {
    cleaned = cleaned.replaceAll(slang, proper);
  }
  return cleaned.trim();
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
    const { sessionId = "default", userId = "anonymous", text } = req.body;
    if (!text) return res.status(400).json({ error: "Missing text" });

    const session = sessions[sessionId] || { history: [], currentRestaurant: null };
    const normalizedText = normalizeInput(text);

    // 🧠 1️⃣ Jeśli nie ma restauracji w sesji, spróbuj wykryć nazwę
    if (!session.currentRestaurant) {
      const found = resolveRestaurantName(normalizedText);
      if (found) {
        session.currentRestaurant = found;
        session.history = []; // Reset historii dla nowej restauracji
        sessions[sessionId] = session;
        
        console.log('🔍 Ustawiono restaurację:', found);
        
        return res.json({
          ok: true,
          response: `Świetnie! W ${found} mamy kilka dań i napojów. Co chcesz zamówić? 🍽️`,
          sessionId,
        });
      }

      // Brak restauracji → zapytaj użytkownika
      return res.json({
        ok: true,
        response: "Z jakiej restauracji chcesz zamówić? Mam listę lokali w pobliżu: Monte Carlo, Praga, Rezydencja, Tasty King.",
        sessionId,
      });
    }

    // 🧠 2️⃣ Jeśli wiadomo, skąd zamawia — sprawdź czy to zapytanie o menu
    const menuKeywords = [
      'co mam do wyboru', 'co jest w menu', 'co macie', 'menu', 'co polecacie', 'co jest dostępne',
      'co masz w ofercie', 'co masz', 'oferta', 'co polecasz', 'co jest do jedzenia',
      'co jest do picia', 'co jest do zamówienia', 'co jest dostępne do zamówienia'
    ];
    const isMenuQuery = menuKeywords.some(keyword => normalizedText.includes(keyword));
    
    console.error('🔍 Debug:', { normalizedText, isMenuQuery, currentRestaurant: session.currentRestaurant });
    
    if (isMenuQuery) {
      console.error('🔍 Fetching menu for:', session.currentRestaurant);
      // Pobierz menu z Supabase
      try {
        const supabaseClient = supabase.createClient(
          'https://ezemaacyyvbpjlagchds.supabase.co',
          'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV6ZW1hYWN5eXZicGpsYWdjaGRzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk3ODU1MzYsImV4cCI6MjA3NTM2MTUzNn0.uRKmqxL0Isx3DmOxmgc_zPwG5foYXft9WpIROoTTgGU'
        );
        
        const { data: restaurant } = await supabaseClient
          .from('restaurants')
          .select('id')
          .eq('name', session.currentRestaurant)
          .single();
          
        console.log('🔍 Restaurant found:', restaurant);
          
        if (restaurant) {
          const { data: menuItems } = await supabaseClient
            .from('menu_items')
            .select('name, price, description')
            .eq('restaurant_id', restaurant.id)
            .order('name');
            
          console.log('🔍 Menu items found:', menuItems);
            
          if (menuItems && menuItems.length > 0) {
            let menuText = `W ${session.currentRestaurant} mamy:\n\n`;
            menuItems.forEach(item => {
              menuText += `• ${item.name} - ${Number(item.price).toFixed(2)} zł\n`;
              if (item.description) {
                menuText += `  ${item.description}\n`;
              }
            });
            menuText += `\nCo chcesz zamówić? 🍽️`;
            
            session.history.push({ role: "user", content: normalizedText });
            session.history.push({ role: "assistant", content: menuText });
            sessions[sessionId] = session;
            
            return res.json({
              ok: true,
              response: menuText,
              sessionId,
              userId,
              timestamp: new Date().toISOString(),
            });
          }
        }
      } catch (error) {
        console.error("Error fetching menu:", error);
      }
    }

    // 🧠 3️⃣ Jeśli nie to zapytanie o menu — przekaż do GPT
    const SYSTEM = SYSTEM_PROMPT(session);

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.5,
      messages: [
        { role: "system", content: SYSTEM },
        ...(session.history || []),
        { role: "user", content: normalizedText },
      ],
    });

    const reply = completion.choices[0].message.content.trim();

    // 🧩 Aktualizacja pamięci
    session.history.push({ role: "user", content: normalizedText });
    session.history.push({ role: "assistant", content: reply });
    sessions[sessionId] = session;

    res.json({
      ok: true,
      response: reply,
      sessionId,
      userId,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("💥 Brain SMART error:", err);
    res.status(500).json({ error: "Brain internal error", details: err.message });
  }
}