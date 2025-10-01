// /api/orders serverless function for Vercel
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || 'https://xdhlztmjktminrwmzcpl.supabase.co',
  process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhkaGx6dG1qa3RtaW5yd216Y3BsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY3MjgwMTEsImV4cCI6MjA3MjMwNDAxMX0.EmvBqbygr4VLD3PXFaPjbChakRi5YtSrxp8e_K7ZyGY'
);

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  // Handle OPTIONS request
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  
  // Handle GET request - list orders
  if (req.method === 'GET') {
    try {
      const { customer_id, restaurant_id } = req.query;
      
      let query = supabase
        .from('orders')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (customer_id) {
        query = query.eq('customer_id', customer_id);
      }
      
      if (restaurant_id) {
        query = query.eq('restaurant_id', restaurant_id);
      }
      
      const { data, error } = await query;
      
      if (error) {
        console.error('Supabase error:', error);
        return res.status(500).json({ 
          error: 'Database error', 
          detail: error.message 
        });
      }
      
      res.status(200).json({ 
        ok: true, 
        orders: data || [],
        count: data?.length || 0
      });
    } catch (err) {
      console.error('Orders GET error:', err);
      res.status(500).json({ 
        error: 'Server error', 
        detail: err.message 
      });
    }
    return;
  }
  
  // Handle POST request - create order
  if (req.method === 'POST') {
    try {
      const { restaurantId, items, customerId, total, ...rest } = req.body;
      
      if (!restaurantId || !items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ 
          error: 'Missing required fields: restaurantId, items' 
        });
      }
      
      const orderData = {
        restaurant_id: restaurantId,
        customer_id: customerId || null,
        items: items,
        total: total || 0,
        status: 'pending',
        created_at: new Date().toISOString(),
        ...rest
      };
      
      const { data, error } = await supabase
        .from('orders')
        .insert([orderData])
        .select()
        .single();
      
      if (error) {
        console.error('Supabase error:', error);
        return res.status(500).json({ 
          error: 'Database error', 
          detail: error.message 
        });
      }
      
      res.status(200).json({ 
        ok: true, 
        order: data 
      });
    } catch (err) {
      console.error('Orders POST error:', err);
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
