// freeflow-backend/api/orders.js
import express from 'express';
import { supabase } from '../lib/supabase.js';

export const ordersRouter = express.Router();

// Generuj czytelną nazwę zamówienia na podstawie pozycji
function generateOrderName(items) {
  if (!items || items.length === 0) return 'Puste zamówienie';
  
  if (items.length === 1) {
    const item = items[0];
    return `${item.name}${item.qty > 1 ? ` (${item.qty}x)` : ''}`;
  }
  
  if (items.length === 2) {
    const item1 = items[0];
    const item2 = items[1];
    return `${item1.name}${item1.qty > 1 ? ` (${item1.qty}x)` : ''}, ${item2.name}${item2.qty > 1 ? ` (${item2.qty}x)` : ''}`;
  }
  
  // Dla więcej niż 2 pozycji - pokaż pierwszą i liczbę pozostałych
  const firstItem = items[0];
  const remaining = items.length - 1;
  return `${firstItem.name}${firstItem.qty > 1 ? ` (${firstItem.qty}x)` : ''} + ${remaining} więcej`;
}

ordersRouter.post('/orders', async (req, res) => {
  try {
    const { restaurantId, items, customerId, total } = req.body || {};
    if (!restaurantId || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Invalid payload' });
    }

    console.log('📦 Creating order:', { restaurantId, items, customerId, total });

    // Generuj czytelną nazwę zamówienia
    const orderName = generateOrderName(items);
    console.log('📝 Order name:', orderName);

    // Zapisz zamówienie do bazy danych
    const { data, error } = await supabase
      .from('orders')
      .insert({
        restaurant: restaurantId,
        customer: customerId || 'anonymous',
        items: JSON.stringify(items),
        total: total || items.reduce((sum, item) => sum + (item.price * item.qty), 0),
        status: 'pending',
        order_name: orderName,
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) {
      console.error('❌ Database error:', error);
      return res.status(500).json({ error: 'Database error' });
    }

    console.log('✅ Order created:', data);
    res.json({ 
      orderId: data.id,
      status: 'success',
      message: 'Zamówienie zostało złożone!'
    });
  } catch (e) {
    console.error('❌ Orders error', e);
    res.status(500).json({ error: String(e?.message || e) });
  }
});