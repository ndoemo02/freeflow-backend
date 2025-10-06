// handler dla POST /api/dialogflow-freeflow
import crypto from 'node:crypto';

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// Feature flag dla ceny
const PRICE_PLN = Number(process.env.PRICE_PLN ?? 31);

// In-memory storage dla idempotencji (w produkcji użyj Redis/DB)
const orderCache = new Map();

export default async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).set(corsHeaders).end();
  }


  try {
    const { sessionInfo, fulfillmentInfo } = req.body ?? {};
    const { dish, qty, client_order_id } = sessionInfo?.parameters ?? {};
    const tag = fulfillmentInfo?.tag;

    if (tag === 'create_order' && dish && qty) {
      // Idempotencja - sprawdź czy już istnieje
      if (client_order_id && orderCache.has(client_order_id)) {
        const cached = orderCache.get(client_order_id);
        return res.status(200).set(corsHeaders).json({
          sessionInfo: {
            parameters: cached
          },
          fulfillment_response: {
            messages: [
              { text: { text: [ `Zamówienie już istnieje. ${cached.items_summary}. Dostawa ${cached.eta}.` ] } }
            ]
          }
        });
      }

      // Generuj nowe zamówienie
      const order_id = crypto.randomUUID();
      const etaMin = 15, etaMax = 20;
      const price_total = (PRICE_PLN * Number(qty)).toFixed(2) + ' zł';
      const items_summary = `${qty}× ${dish}`;

      const orderData = {
        order_id,
        eta: `${etaMin}–${etaMax} min`,
        price_total,
        items_summary
      };

      // Cache dla idempotencji
      if (client_order_id) {
        orderCache.set(client_order_id, orderData);
      }

      return res.status(200).set(corsHeaders).json({
        sessionInfo: {
          parameters: orderData
        },
        fulfillment_response: {
          messages: [
            { text: { text: [ `Zamówienie przyjęte. ${items_summary}. Dostawa ${etaMin}–${etaMax} min.` ] } }
          ]
        }
      });
    }

    // fallback: gdy brak taga/danych
    return res.status(200).set(corsHeaders).json({
      fulfillment_response: {
        messages: [{ text: { text: [ 'OK, przyjąłem dane. Powiedz co chcesz zamówić.' ] } }]
      }
    });
  } catch (e) {
    console.error(e);
    return res.status(500).set(corsHeaders).json({
      fulfillment_response: { messages: [{ text: { text: [ 'Błąd serwera. Spróbuj ponownie.' ] } }] }
    });
  }
}
