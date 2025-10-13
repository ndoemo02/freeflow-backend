// /api/brain/amber.js - Amber Brain v2 with Adaptive Tone (Simplified)
import { AMBER_ADAPTIVE_PROMPT } from "../../lib/promptAmberAdaptive.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = await req.json?.() || req.body || {};
    const { text } = body;

    if (!text) {
      return res.status(400).json({ ok: false, error: "missing_text" });
    }

    const completion = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.6,
        messages: [
          { role: "system", content: AMBER_ADAPTIVE_PROMPT },
          { role: "user", content: text }
        ],
        response_format: { type: "json_object" }
      })
    });

    const data = await completion.json();
    const parsed = safeParse(data?.choices?.[0]?.message?.content);

    return res.status(200).json({
      ok: true,
      tone: parsed.tone || "neutralny",
      intent: parsed.intent || "unknown",
      restaurant_name: parsed.restaurant_name || null,
      items: parsed.items || [],
      reply: parsed.reply || "Nie jestem pewna, co masz na myśli — możesz powtórzyć?"
    });
  } catch (err) {
    console.error("Amber Adaptive error:", err);
    res.status(500).json({ ok: false, error: "amber_adaptive_failed" });
  }
}

function safeParse(str) {
  try {
    return JSON.parse(str);
  } catch {
    return {};
  }
}