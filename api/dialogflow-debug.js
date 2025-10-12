// /api/dialogflow-debug.js - Debug webhook do testowania
export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  try {
    console.log('📡 Debug webhook hit:', req.method);
    
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    // Ręczne czytanie body (dla Vercel)
    let rawBody = '';
    for await (const chunk of req) {
      rawBody += chunk;
    }
    
    console.log('📦 Raw body:', rawBody);
    
    let data;
    try {
      data = JSON.parse(rawBody);
    } catch (parseError) {
      console.error('JSON parse error:', parseError);
      return res.status(400).json({ error: 'Invalid JSON' });
    }
    
    console.log('✅ Parsed body:', data);
    
    const tag = data?.fulfillmentInfo?.tag || 'no tag';
    const params = data?.sessionInfo?.parameters || {};
    
    return res.status(200).json({
      message: 'Debug OK',
      method: req.method,
      tag: tag,
      parameters: params,
      body: data,
    });
    
  } catch (err) {
    console.error('❌ Debug Error:', err);
    return res.status(500).json({ error: err.message });
  }
}
