import { fallbackIntent } from "./fallbackIntent.js";
import { refineIntentLLM } from "./llmRefiner.js";

export { detectIntent, normalizeTxt } from "../intent-router.js";

export async function resolveIntent({ text, coarseIntent, session }) {
  const intentAfterFallback = fallbackIntent(text, coarseIntent, null, session);

  try {
    const refined = await refineIntentLLM({ text, coarseIntent: intentAfterFallback, session });
    const intent = refined?.intent && refined.intent !== "unknown" ? refined.intent : intentAfterFallback;

    return {
      intent,
      targetRestaurant: refined?.targetRestaurant,
      targetItems: refined?.targetItems,
      action: refined?.action,
      quantity: refined?.quantity,
    };
  } catch (err) {
    console.warn("⚠️ resolveIntent: LLM refinement failed, using fallback intent", err?.message);
    return { intent: intentAfterFallback };
  }
}
