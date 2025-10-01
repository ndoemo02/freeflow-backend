// /api/places serverless function for Vercel
// This is an alias for the search endpoint

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
    try {
      const { q, lat, lng, n = '5', radius = '5000' } = req.query;
      
      // Import and use the search handler
      const searchModule = await import('./search.js');
      const searchHandler = searchModule.default;
      
      // Create a new request object with the query parameter
      const searchReq = {
        ...req,
        query: {
          query: q || 'restaurant',
          lat,
          lng,
          n,
          radius
        }
      };
      
      // Call the search handler
      return await searchHandler(searchReq, res);
    } catch (err) {
      console.error('Places API error:', err);
      res.status(500).json({ 
        error: 'Server error', 
        detail: err.message 
      });
    }
    return;
  }
  
  // Method not allowed
  res.status(405).json({ error: 'Method not allowed' });
}
