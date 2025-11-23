export async function refineIntentLLM({ text, coarseIntent }) {
  return {
    intent: coarseIntent || "none",
    targetRestaurant: null,
    targetItems: null,
    action: null,
    quantity: null,
    text,
  };
}
