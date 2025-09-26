// api/menu.js
import { applyCors } from '../lib/cors.js';
import { supabase } from '../lib/supabase.js';

export default async function handler(req, res) {
  if (applyCors(req, res)) return;

  try {
    if (!supabase) {
      return res.status(500).json({ error: 'Supabase not configured' });
    }

    const { restaurant_id, q } = req.query;
    
    if (!restaurant_id) {
      return res.status(400).json({ error: 'Missing restaurant_id' });
    }
    
    let query = supabase
      .from('menu_items')
      .select('*')
      .eq('restaurant_id', restaurant_id);
    
    if (q) {
      query = query.ilike('name', `%${q}%`);
    }
    
    const { data, error } = await query;
    
    if (error) {
      console.error('Supabase error:', error);
      return res.status(500).json({ error: 'Database error' });
    }
    
    // Fallback: jeśli baza jest pusta, użyj hardcoded danych
    let results = data || [];
    if (results.length === 0) {
      console.log('📋 Database empty, using fallback menu data');
      results = [
        { id: '1', name: 'Pizza Margherita', price: 32, restaurant_id },
        { id: '2', name: 'Pizza Pepperoni', price: 38, restaurant_id },
        { id: '3', name: 'Pizza Capricciosa', price: 39, restaurant_id },
        { id: '4', name: 'Pizza Veggie', price: 35, restaurant_id },
        { id: '5', name: 'Big Mac', price: 18, restaurant_id },
        { id: '6', name: 'Frytki', price: 8, restaurant_id },
        { id: '7', name: 'Coca-Cola', price: 6, restaurant_id },
        { id: '8', name: 'Popcorn Chicken', price: 15, restaurant_id },
        { id: '9', name: 'Zinger Box', price: 25, restaurant_id },
        { id: '10', name: 'Hot Wings (6szt)', price: 18, restaurant_id }
      ];
    }
    
    res.json({ 
      status: 'OK',
      total: results.length,
      results: results 
    });
  } catch (err) {
    console.error('Menu API error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
}
