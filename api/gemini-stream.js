export default async function handler(req, res) {
  try {
    // 1) Nagłówki SSE
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.(); // jeśli jest dostępne

    // 2) Parametry
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: "Missing GEMINI_API_KEY" })}\n\n`);
      return res.end();
    }

    // GET (SSE używa GET) – prompt i (opcjonalnie) context w base64
    const prompt = (req.query?.prompt || "").toString();
    const contextB64 = (req.query?.context || "").toString(); // opcjonalnie
    let contextText = "";
    if (contextB64) {
      try { contextText = Buffer.from(contextB64, "base64").toString("utf8"); } catch {}
    }

    if (!prompt.trim()) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: "Missing 'prompt'" })}\n\n`);
      return res.end();
    }

    // 3) Zasady rozmowy (opcjonalnie – jak w Twoim /api/gemini)
    const systemRules = `
Rola: Asystent zamówień FreeFlow.
Zasady:
1) Zapytaj o preferencje (wege/vegan, ostrość, alergie, budżet).
2) Proponuj 1–3 pozycje z kontekstu (jeśli jest). Nie wymyślaj spoza.
3) Dopytaj o ilość i notatki.
4) Po potwierdzeniu zwróć na końcu JSON akcji:
{"action":"add_to_cart","items":[{"id":"carbonara","name":"Makaron Carbonara","price":36,"qty":2,"notes":"bez boczku"}]}
5) Finalizacja: {"action":"checkout"}
Po dodaniu: "Dodałem do koszyka. Aby sfinalizować, przejdź do Koszyka i kliknij Złóż zamówienie."
`.trim();

    const ctxBlock = contextText
      ? `KONTEKST:\n${contextText.slice(0, 12000)}\n`
      : "";

    const fullPrompt = [systemRules, ctxBlock, `ZADANIE:\n${prompt}`]
      .filter(Boolean).join("\n\n");

    // 4) Wołamy REST API Geminiego (generateContent)
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    const glReqBody = { contents: [{ parts: [{ text: fullPrompt }]}] };

    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(glReqBody)
    });

    if (!r.ok) {
      const errTxt = await r.text();
      res.write(`event: error\ndata: ${JSON.stringify({ status: r.status, body: errTxt })}\n\n`);
      return res.end();
    }

    const data = await r.json();
    const text =
      data?.candidates?.[0]?.content?.parts?.map(p => p.text).join("") ??
      data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    // 5) „Udawane” strumieniowanie – wysyłamy tekst porcjami
    const chunks = text.match(/.{1,80}/gs) || [text]; // porcje po ~80 znaków
    for (const ch of chunks) {
      res.write(`data: ${JSON.stringify({ token: ch })}\n\n`);
      await new Promise(r => setTimeout(r, 15)); // delikatny „typing”
    }

    // Na koniec – pełny tekst (dla parsowania JSON akcji na froncie)
    res.write(`event: done\ndata: ${JSON.stringify({ text })}\n\n`);
    res.end();
  } catch (err) {
    console.error("gemini-stream error:", err);
    try {
      res.write(`event: error\ndata: ${JSON.stringify({ error: err.message || "Internal error" })}\n\n`);
    } catch {}
    res.end();
  }
}