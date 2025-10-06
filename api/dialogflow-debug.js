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

    let rawBody = '';
    for await (const chunk of req) rawBody += chunk;
    console.log('📦 Raw body:', rawBody);

    let data;
    try {
      data = JSON.parse(rawBody);
    } catch {
      return res.status(400).json({ error: 'Invalid JSON' });
    }

    console.log('✅ Parsed body:', data);

    return res.status(200).json({
      message: 'OK',
      method: req.method,
      body: data,
    });
  } catch (err) {
    console.error('❌ Error:', err);
    return res.status(500).json({ error: err.message });
  }
}
