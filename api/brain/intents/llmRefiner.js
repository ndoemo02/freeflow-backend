// api/brain/intents/llmRefiner.js
import { OpenAI } from "openai";
import { normalizeText } from "../utils/normalizeText.js";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function refineIntentLLM({ text, coarseIntent, session }) {
  const normalized = normalizeText(text || "");

  try {
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",   // stabilny i tani, idealny do runtime
      messages: [
        {
          role: "system",
          content: `
Jesteś modułem analizującym intencje użytkownika dla systemu zamawiania jedzenia.
Twoim zadaniem jest ujednolicenie intencji do precyzyjnej struktury JSON.

Zwracaj TYLKO JSON. Bez wyjaśnień.

Dopuszczalne pola:

{
  "intent": string,             // find_restaurant, show_menu, add_to_cart, modify_order, confirm_order, cancel_order, smalltalk, unknown
  "targetRestaurant": string | null,
  "targetItems": string[] | null,
  "quantity": number | null,
  "action": string | null,       // replace, add, remove, inquire
  "confidence": number
}

Jeśli wypowiedź nie dotyczy jedzenia → intent: "smalltalk".
Jeśli nie wiesz → intent: "unknown".
`
        },
        {
          role: "user",
          content: JSON.stringify({
            text: normalized,
            coarseIntent,
            lastRestaurant: session?.lastRestaurant || null,
            cart: session?.cart || null
          })
        }
      ],
      temperature: 0.2,
    });

    const raw = response.choices[0].message.content;

    const parsed = JSON.parse(raw);
    return parsed;

  } catch (err) {
    console.error("LLM REFINER ERROR:", err);
    return {
      intent: "unknown",
      targetRestaurant: null,
      targetItems: null,
      quantity: null,
      action: null,
      confidence: 0.2
    };
  }
}
