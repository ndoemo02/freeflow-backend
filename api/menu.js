// /api/menu serverless function for Vercel
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || 'https://xdhlztmjktminrwmzcpl.supabase.co',
  process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhkaGx6dG1qa3RtaW5yd216Y3BsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY3MjgwMTEsImV4cCI6MjA3MjMwNDAxMX0.EmvBqbygr4VLD3PXFaPjbChakRi5YtSrxp8e_K7ZyGY'
);

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
      const { restaurant_id } = req.query;
      
      if (!restaurant_id) {
        return res.status(400).json({ 
          error: 'Missing restaurant_id parameter' 
        });
      }
      
      const { data, error } = await supabase
        .from('menu_items')
        .select('*')
        .eq('business_id', restaurant_id);
      
      if (error) {
        console.error('Supabase error:', error);
        return res.status(500).json({ 
          error: 'Database error', 
          detail: error.message 
        });
      }
      
      res.status(200).json({ 
        ok: true, 
        menu: data || [],
        count: data?.length || 0
      });
    } catch (err) {
      console.error('Menu API error:', err);
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
