// /api/business-panel.js — endpoint dla paneli biznesowych
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

export default async function handler(req, res) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ 
      ok: false, 
      error: "METHOD_NOT_ALLOWED", 
      message: "Tylko metoda GET jest obsługiwana" 
    });
  }

  try {
    // Pobieranie user_id z query parameters lub headers
    const userId = req.query.user_id || req.headers['x-user-id'];
    
    if (!userId) {
      return res.status(401).json({
        ok: false,
        error: "UNAUTHORIZED",
        message: "Wymagana autoryzacja użytkownika"
      });
    }

    // Sprawdzenie czy użytkownik to business owner
    console.log('Fetching profile for user_id:', userId);
    
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, email, user_type, business_role, business_id')
      .eq('id', userId)
      .single();

    console.log('Profile query result:', { profile, profileError });

    if (profileError || !profile) {
      console.error('Profile error:', profileError);
      return res.status(404).json({
        ok: false,
        error: "USER_NOT_FOUND",
        message: "Użytkownik nie został znaleziony",
        debug: { profileError, userId }
      });
    }

    // Sprawdzenie czy to konto biznesowe
    if (profile.user_type !== 'business_owner' && profile.user_type !== 'business_staff') {
      return res.status(403).json({
        ok: false,
        error: "NOT_BUSINESS_ACCOUNT",
        message: "To nie jest konto biznesowe",
        data: {
          user_type: profile.user_type,
          should_show_panel: 'private'
        }
      });
    }

    // Pobieranie informacji o biznesie
    const { data: business, error: businessError } = await supabase
      .from('businesses')
      .select('id, name, address, city, phone, is_active')
      .eq('id', profile.business_id)
      .single();

    console.log('Business query result:', { business, businessError });

    // Pobieranie zamówień dla restauracji
    const { data: orders, error: ordersError } = await supabase
      .from('business_orders')
      .select(`
        id, customer_type, status, order_type, details, total_amount, 
        currency, customer_notes, created_at, updated_at,
        routing_metadata, source_location
      `)
      .eq('business_id', profile.business_id)
      .order('created_at', { ascending: false })
      .limit(50);

    console.log('Orders query result:', { orders: orders?.length, ordersError });

    if (ordersError) {
      console.error('Orders fetch error:', ordersError);
    }

    // Przygotowanie danych panelu biznesowego
    const businessData = {
      user: {
        id: profile.id,
        email: profile.email,
        user_type: profile.user_type,
        business_role: profile.business_role
      },
      business: business,
      orders: orders || [],
      statistics: {
        total_orders: orders?.length || 0,
        pending_orders: orders?.filter(o => o.status === 'pending').length || 0,
        completed_orders: orders?.filter(o => o.status === 'completed').length || 0,
        today_revenue: orders?.filter(o => {
          const today = new Date().toDateString();
          const orderDate = new Date(o.created_at).toDateString();
          return orderDate === today && o.status === 'completed';
        }).reduce((sum, o) => sum + parseFloat(o.total_amount || 0), 0) || 0
      }
    };

    return res.status(200).json({
      ok: true,
      message: "Panel biznesowy załadowany pomyślnie",
      data: businessData
    });

  } catch (err) {
    console.error("BUSINESS_PANEL error:", err);
    return res.status(500).json({ 
      ok: false, 
      error: "BUSINESS_PANEL_INTERNAL", 
      message: "Błąd wewnętrzny serwera",
      detail: String(err?.message || err) 
    });
  }
}
