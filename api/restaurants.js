// api/restaurants.js
import { applyCors } from '../lib/cors.js';
import { supabase } from '../lib/supabase.js';

export default async function handler(req, res) {
  if (applyCors(req, res)) return;

  try {
    if (!supabase) {
      return res.status(500).json({ error: 'Supabase not configured' });
    }

    const { q, city } = req.query;
    
    let query = supabase.from('restaurants').select('*');
    
    if (q) {
      query = query.or(`name.ilike.%${q}%,city.ilike.%${q}%`);
    }
    
    if (city) {
      query = query.eq('city', city);
    }
    
    const { data, error } = await query.limit(10);
    
    if (error) {
      console.error('Supabase error:', error);
      return res.status(500).json({ error: 'Database error' });
    }

    // Fallback: jeśli baza jest pusta, użyj hardcoded danych
    let results = data || [];
    if (results.length === 0) {
      console.log('🏪 Database empty, using fallback restaurant data');
      results = [
        { 
          id: '1', 
          name: 'McDonald\'s', 
          type: 'Fast Food',
          city: 'Piekary Śląskie',
          rating: 4.2,
          address: 'ul. Bytomska 15'
        },
        { 
          id: '2', 
          name: 'KFC', 
          type: 'Fast Food',
          city: 'Piekary Śląskie',
          rating: 4.0,
          address: 'ul. Dworcowa 8'
        },
        { 
          id: '3', 
          name: 'Pizza Hut', 
          type: 'Pizzeria',
          city: 'Piekary Śląskie',
          rating: 4.3,
          address: 'ul. Rynek 12'
        },
        { 
          id: '4', 
          name: 'Burger King', 
          type: 'Fast Food',
          city: 'Piekary Śląskie',
          rating: 4.1,
          address: 'ul. Katowicka 25'
        },
        { 
          id: '5', 
          name: 'Subway', 
          type: 'Sandwich',
          city: 'Piekary Śląskie',
          rating: 4.4,
          address: 'ul. Gliwicka 7'
        }
      ];
    }
    
    res.json({ 
      status: 'OK',
      total: results.length,
      results: results 
    });
  } catch (err) {
    console.error('Restaurants API error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
}
