// /api/health serverless function for Vercel
export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  // Handle OPTIONS request
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  
  // Handle GET request
  if (req.method === 'GET') {
    res.status(200).json({ 
      status: 'ok', 
      service: 'freeflow-backend',
      timestamp: new Date().toISOString()
    });
    return;
  }
  
  // Method not allowed
  res.status(405).json({ error: 'Method not allowed' });
}
