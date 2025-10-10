import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export default async function panels(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { action, userId, data } = req.body;

    console.log('🎛️ Panel action:', { action, userId, data });

    switch (action) {
      case 'get_user_orders':
        const { data: orders, error: ordersError } = await supabase
          .from('orders')
          .select('*')
          .eq('user_email', userId)
          .order('created_at', { ascending: false });
        
        if (ordersError) throw ordersError;
        
        return res.json({
          ok: true,
          orders: orders || [],
          count: orders?.length || 0
        });

      case 'get_restaurants':
        const { data: restaurants, error: restaurantsError } = await supabase
          .from('restaurants')
          .select('*');
        
        if (restaurantsError) throw restaurantsError;
        
        return res.json({
          ok: true,
          restaurants: restaurants || []
        });

      case 'get_menu_items':
        const { restaurantId } = data;
        const { data: menuItems, error: menuError } = await supabase
          .from('menu_items')
          .select('*')
          .eq('restaurant_id', restaurantId);
        
        if (menuError) throw menuError;
        
        return res.json({
          ok: true,
          menuItems: menuItems || []
        });

      case 'create_order':
        const { orderData } = data;
        const { data: newOrder, error: createError } = await supabase
          .from('orders')
          .insert([orderData])
          .select();
        
        if (createError) throw createError;
        
        return res.json({
          ok: true,
          order: newOrder?.[0] || null
        });

      case 'update_order_status':
        const { orderId, status } = data;
        const { data: updatedOrder, error: updateError } = await supabase
          .from('orders')
          .update({ status })
          .eq('id', orderId)
          .select();
        
        if (updateError) throw updateError;
        
        return res.json({
          ok: true,
          order: updatedOrder?.[0] || null
        });

      case 'get_user_profile':
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('*')
          .eq('email', userId)
          .single();
        
        if (profileError && profileError.code !== 'PGRST116') throw profileError;
        
        return res.json({
          ok: true,
          profile: profile || null
        });

      case 'update_user_profile':
        const { profileData } = data;
        const { data: updatedProfile, error: profileUpdateError } = await supabase
          .from('profiles')
          .upsert([{ ...profileData, email: userId }])
          .select();
        
        if (profileUpdateError) throw profileUpdateError;
        
        return res.json({
          ok: true,
          profile: updatedProfile?.[0] || null
        });

      default:
        return res.status(400).json({
          ok: false,
          error: 'Unknown action',
          message: `Action "${action}" is not supported`
        });
    }

  } catch (error) {
    console.error('❌ Panel error:', error);
    
    res.status(500).json({
      ok: false,
      error: 'PANEL_ERROR',
      message: error.message
    });
  }
}
