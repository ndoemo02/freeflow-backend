// /api/dialogflow-freeflow-test.js
export default async function handler(req, res) {
  console.log('✅ TEST WEBHOOK HIT:', req.method, req.body);

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // szybka odpowiedź testowa — bez zależności od logiki projektu
  return res.status(200).json({
    fulfillment_response: {
      messages: [
        {
          text: {
            text: [
              `Zamówienie testowe przyjęte: ${req.body?.sessionInfo?.parameters?.food_item || 'nieznane danie'}`,
            ],
          },
        },
      ],
    },
  });
}
