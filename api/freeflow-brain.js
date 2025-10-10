// FreeFlow Brain - Smart conversation logic
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { text } = req.body;

    if (!text) {
      return res.status(400).json({ 
        ok: false, 
        error: "Missing text parameter" 
      });
    }

    console.log("🧠 FreeFlow Brain processing:", text);

    // Na start - prosta logika zamiast DF
    let reply = "Nie do końca rozumiem, możesz powtórzyć?";
    
    // Pizza logic
    if (text.match(/pizza|margherita|pepperoni|capricciosa/i)) {
      reply = "Mam dziś promocję na pizzę! Margherita 25zł, Pepperoni 28zł. Którą wybierasz?";
    }
    // Burger logic
    else if (text.match(/burger|hamburger|cheeseburger/i)) {
      reply = "Burger Classic z sosem freeflow, polecam! Z frytkami i colą 32zł.";
    }
    // Kebab logic
    else if (text.match(/kebab|kebap|döner/i)) {
      reply = "Kebab z baraniny, świeży, pachnący czosnkiem 😎 Z sałatką 18zł.";
    }
    // Taxi logic
    else if (text.match(/taxi|taksówka|przejazd|dowóz/i)) {
      reply = "Zamawiam taksówkę! Dokąd jedziemy? Podaj adres docelowy.";
    }
    // Hotel logic
    else if (text.match(/hotel|nocleg|apartament|pokój/i)) {
      reply = "Mam dostępne pokoje! Na ile nocy? Jaki standard preferujesz?";
    }
    // Greeting logic
    else if (text.match(/cześć|witaj|dzień dobry|hej/i)) {
      reply = "Cześć! Jestem FreeFlow - pomogę Ci zamówić jedzenie, taksówkę lub hotel. Co Cię interesuje?";
    }
    // Help logic
    else if (text.match(/pomoc|help|co możesz|menu/i)) {
      reply = "Mogę pomóc Ci z: 🍕 Jedzeniem, 🚕 Taksówką, 🏨 Hotelem. Powiedz co Cię interesuje!";
    }
    // Order logic
    else if (text.match(/zamów|zamawiam|chcę|potrzebuję/i)) {
      reply = "Świetnie! Co chcesz zamówić? Pizza, burger, kebab, taksówka czy hotel?";
    }

    console.log("🧠 FreeFlow Brain response:", reply);

    return res.status(200).json({
      ok: true,
      response: reply,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error("❌ FreeFlow brain error:", err);
    return res.status(500).json({ 
      ok: false, 
      error: err.message 
    });
  }
}
