// /api/tts serverless function for Vercel
export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  // Handle OPTIONS request
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  
  // Handle POST request
  if (req.method === 'POST') {
    try {
      res.setHeader('Content-Type', 'application/json');
      res.status(200).json({ 
        ok: true, 
        message: 'TTS placeholder (tu podłączymy Google/ElevenLabs)' 
      });
    } catch (error) {
      console.error('TTS error:', error);
      res.status(500).json({ 
        ok: false, 
        error: 'TTS_ERROR', 
        detail: error.message 
      });
    }
    return;
  }
  
  // Method not allowed
  res.status(405).json({ error: 'Method not allowed' });
}
