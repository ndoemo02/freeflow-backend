// handler dla POST /api/dialogflow-freeflow
import crypto from 'node:crypto';

export default async function handler(req, res) {
  try {
    const tag = req.body?.fulfillmentInfo?.tag || "UNKNOWN";
    const p   = req.body?.sessionInfo?.parameters || {};

    if (tag !== "create_order") {
      return res.status(200).json({
        fulfillment_response: {
          messages: [{ text: { text: [`Tag ${tag} nieobsługiwany.`] } }]
        }
      });
    }

    const dish = String(p.dish || "pizza");
    const qty  = Number(p.qty ?? 1) || 1;

    const price = 31 * qty;
    const items = `${qty}× ${dish[0].toUpperCase()}${dish.slice(1)}`;

    return res.status(200).json({
      sessionInfo: {
        parameters: {
          order_id: crypto.randomUUID(),
          eta: "15–20 min",
          price_total: `${price.toFixed(2)} zł`,
          items_summary: items
        }
      },
      fulfillment_response: {
        messages: [{ text: { text: [`Zamówienie przyjęte. ${items}. Dostawa 15–20 min.`] } }]
      }
    });
  } catch (e) {
    console.error("WEBHOOK ERROR", e, req.body); // zobaczysz w Vercel Logs
    return res.status(200).json({
      fulfillment_response: {
        messages: [{ text: { text: ["OK, przyjąłem dane. Powiedz co chcesz zamówić."] } }]
      }
    });
  }
}
