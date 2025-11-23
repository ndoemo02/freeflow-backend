// api/brain/intents/llmRefiner.js
import { OpenAI } from "openai";
import { normalizeText } from "../utils/normalizeText.js";

// jeśli brak klucza — moduł działa w trybie awaryjnym (zwraca coarse intent)
const client =
  process.env.OPENAI_API_KEY
    ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    : null;

/**
 * refineIntentLLM
 * Precyzuje coarse intent → final JSON intent
 * Zawsze zwraca strukturę zgodną ze schematem
 */
export async function refineIntentLLM({ text, coarseIntent, session }) {
  const normalized = normalizeText(text || "");

  // tryb awaryjny (np. w dev, test lub brak klucza)
  if (!client) {
    return {
      intent: coarseIntent || "none",
      targetRestaurant: null,
      targetItems: null,
      action: null,
      quantity: null,
      confidence: 0.3,
      text,
    };
  }

  try {
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: `
Jesteś modułem analizującym intencje użytkownika dla systemu zamawiania jedzenia.
Twoim zadaniem jest ujednolicenie intencji do precyzyjnej struktury JSON.
Zwracaj TYLKO JSON — bez wyjaśnień, bez tekstów dodatkowych.

Dopuszczalne pola:
{
  "intent": string,            // find_restaurant, show_menu, add_to_cart, modify_order,
                               // confirm_order, cancel_order, smalltalk, unknown
  "targetRestaurant": string | null,
  "targetItems": string[] | null,
  "quantity": number | null,
  "action": string | null,     // add, remove, replace, inquire
  "confidence": number
}

Jeśli wypowiedź nie dotyczy jedzenia → intent: "smalltalk".
Jeśli nie wiesz → intent: "unknown".
        `,
        },
        {
          role: "user",
          content: JSON.stringify({
            text: normalized,
            coarseIntent,
            lastRestaurant: session?.lastRestaurant || null,
            cart: session?.cart || null,
          }),
        },
      ],
    });

    const raw = response.choices[0?.].message?.content ?? "{}";

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { intent: "unknown" };
    }

    return {
      intent: parsed.intent || "unknown",
      targetRestaurant: parsed.targetRestaurant || null,
      targetItems: parsed.targetItems || null,
      quantity: parsed.quantity || null,
      action: parsed.action || null,
      confidence: parsed.confidence ?? 0.6,
    };
  } catch (err) {
    console.error("LLM REFINER ERROR:", err);

    return {
      intent: "unknown",
      targetRestaurant: null,
      targetItems: null,
      quantity: null,
      action: null,
      confidence: 0.2,
    };
  }
}
