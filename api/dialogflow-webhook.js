export default async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    body ||= {};

    const tag    = body?.fulfillmentInfo?.tag || '';
    const params = body?.sessionInfo?.parameters || {};

    if (tag === 'PLACES_RECS') {
      const dishType = String(params.dish_type ?? '');
      const radiusKm = Number(params.radius_km ?? 10);
      const results = [
        { name: 'Rybna Fala',     distance_km: 2.1 },
        { name: 'Karczma Śląska', distance_km: 3.8 },
        { name: 'Złota Okońka',   distance_km: 6.4 },
      ];
      const lines = results.map(r => `${r.name} — ok. ${r.distance_km} km`).join('\n');

      return res.status(200).json({
        fulfillment_response: { messages: [{ text: { text: [
          `Dla ${dishType} w promieniu ${radiusKm} km mam:\n${lines}\nChcesz coś do picia?`
        ]}}]},
        session_info: { parameters: { restaurant_options: results } }
      });
    }

    if (tag === 'ORDER_CREATE') {
      const food  = String(params.food_item ?? '');
      const count = Number(params.number ?? 1);
      const drink = params.drink ? String(params.drink) : null;

      const orderId = Math.floor(Math.random() * 1_000_000);
      const eta = '40–60 min';

      return res.status(200).json({
        fulfillment_response: { messages: [{ text: { text: [
          `Zamówienie #${orderId} przyjęte: ${count} × ${food}${drink ? ` + ${drink}` : ''}. Czas: ${eta}.`
        ]}}]},
        session_info: { parameters: { order_id: orderId, eta } }
      });
    }

    return res.status(200).json({
      fulfillment_response: { messages: [{ text: { text: ['OK. (nieznany tag)'] } }] }
    });
  } catch (e) {
    console.error('DF CX ERR', e);
    return res.status(200).json({
      fulfillment_response: { messages: [{ text: { text: ['Błąd serwera testowego.'] } }] }
    });
  }
};
