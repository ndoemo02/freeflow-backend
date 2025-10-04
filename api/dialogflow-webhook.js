module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    if (!body) body = {};

    const tag = body?.fulfillmentInfo?.tag || '(brak tagu)';
    return res.status(200).json({
      fulfillment_response: { messages: [{ text: { text: [`OK (sanity) tag: ${tag}`] } }] }
    });
  } catch (e) {
    console.error('SANITY ERR', e);
    return res.status(200).json({
      fulfillment_response: { messages: [{ text: { text: ['Błąd sanity handlera'] } }] }
    });
  }
};
