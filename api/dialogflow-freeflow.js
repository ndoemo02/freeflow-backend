// handler dla POST /api/dialogflow-freeflow
import crypto from 'node:crypto';

export default async function handler(req, res) {
  try {
    const { sessionInfo, fulfillmentInfo } = req.body ?? {};
    const { dish, qty } = sessionInfo?.parameters ?? {};
    const tag = fulfillmentInfo?.tag;

    if (tag === 'create_order' && dish && qty) {
      // TODO: realne liczenie ceny i ETA
      const order_id = crypto.randomUUID();
      const etaMin = 15, etaMax = 20;
      const price_total = (31 * Number(qty)).toFixed(2) + ' zł';
      const items_summary = `${qty}× ${dish}`;

      return res.status(200).json({
        sessionInfo: {
          parameters: {
            order_id,
            eta: `${etaMin}–${etaMax} min`,
            price_total,
            items_summary
          }
        },
        fulfillment_response: {
          messages: [
            { text: { text: [ `Zamówienie przyjęte. ${items_summary}. Dostawa ${etaMin}–${etaMax} min.` ] } }
          ]
        }
      });
    }

    // fallback: gdy brak taga/danych
    return res.status(200).json({
      fulfillment_response: {
        messages: [{ text: { text: [ 'OK, przyjąłem dane. Powiedz co chcesz zamówić.' ] } }]
      }
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({
      fulfillment_response: { messages: [{ text: { text: [ 'Błąd serwera. Spróbuj ponownie.' ] } }] }
    });
  }
}
