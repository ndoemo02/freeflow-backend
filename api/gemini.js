// api/gemini.js
export default async function handler(req, res) {
  try {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "Missing GEMINI_API_KEY (or GOOGLE_API_KEY) in .env" });

    const method  = req.method.toUpperCase();
    const payload = method === "GET" ? { prompt: req.query?.prompt, context: req.query?.context } : (req.body || {});
    const prompt  = (payload?.prompt || "").toString().trim();
    const model   = (payload?.model  || "gemini-1.5-flash").toString();
    const ctx     = payload?.context;

    if (!prompt) return res.status(400).json({ error: "Missing 'prompt'." });

    // Zasady rozmowy (pref + koszyk). To możesz skrócić / zmienić pod siebie.
    const systemRules = `
Rola: Asystent zamówień FreeFlow.
Zasady:
1) Najpierw zapytaj o preferencje: wege/vegan, ostrość, alergie, budżet.
2) Proponuj 1–3 pozycje z KONTEKSTU. Nie wymyślaj dań spoza kontekstu.
3) Dopytaj o ilość i notatki.
4) Po POTWIERDZENIU zwróć na końcu OSOBNY blok JSON (i tylko jeden, bez komentarzy):
{"action":"add_to_cart","items":[{"id":"carbonara","name":"Makaron Carbonara","price":36,"qty":2,"notes":"bez boczku"}]}
5) Jeśli użytkownik chce finalizować, zwróć:
{"action":"checkout"}
6) Po dodaniu do koszyka napisz: "Dodałem do koszyka. Aby sfinalizować, przejdź do Koszyka i kliknij Złóż zamówienie."
Odpowiadaj po polsku, krótko.
`.trim();

    // Sklej kontekst (tablica obiektów lub string)
    let ctxBlock = "";
    if (Array.isArray(ctx) && ctx.length) {
      // limit 12k znaków, żeby nie przebić limitów
      const sliced = JSON.stringify(ctx).slice(0, 12000);
      ctxBlock = `KONTEKST (JSON):\n${sliced}\n`;
    } else if (typeof ctx === "string" && ctx.trim()) {
      ctxBlock = `KONTEKST:\n${ctx.slice(0, 12000)}\n`;
    }

    const fullPrompt = [systemRules, ctxBlock, `ZADANIE:\n${prompt}`].filter(Boolean).join("\n\n");

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`;
    const body = { contents: [{ parts: [{ text: fullPrompt }]}] };

    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    const txt = await r.text();
    if (!r.ok) return res.status(r.status).send(txt);

    const data = JSON.parse(txt);
    const text =
      data?.candidates?.[0]?.content?.parts?.map(p => p.text).join("") ??
      data?.candidates?.[0]?.content?.parts?.[0]?.text ??
      "";

    res.json({ model, text, raw: data });
  } catch (err) {
    console.error("Gemini route error:", err);
    res.status(500).json({ error: err.message || "Internal error" });
  }
}
