// /api/order-routing.js — endpoint do kierowania zamówień do restauracji
import { createClient } from '@supabase/supabase-js';

import { applyCors } from '../lib/cors.js';


const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

export default async function handler(req, res) {
  if (applyCors(req, res)) return;

  if (req.method !== "POST") {
    return res.status(405).json({ 
      ok: false, 
      error: "METHOD_NOT_ALLOWED", 
      message: "Tylko metoda POST jest obsługiwana" 
    });
  }

  try {
    const {
      customer_id,
      order_items,
      delivery_address,
      customer_notes,
      customer_location, // { lat, lng, address }
      order_type = 'regular'
    } = req.body;

    if (!order_items || !Array.isArray(order_items) || order_items.length === 0) {
      return res.status(400).json({
        ok: false,
        error: "MISSING_ORDER_ITEMS",
        message: "Wymagane są pozycje zamówienia"
      });
    }

    // Logika kierowania zamówienia
    const routingResult = await routeOrderToBusiness({
      order_items,
      customer_location,
      order_type
    });

    if (!routingResult.business_id) {
      return res.status(404).json({
        ok: false,
        error: "NO_BUSINESS_FOUND",
        message: "Nie znaleziono odpowiedniej restauracji",
        details: routingResult.reason
      });
    }

    // Obliczenie wartości zamówienia
    const total_amount = order_items.reduce((sum, item) => {
      return sum + (parseFloat(item.price || 0) * parseInt(item.quantity || 1));
    }, 0);

    // Tworzenie zamówienia w bazie danych
    const { data: newOrder, error: orderError } = await supabase
      .from('business_orders')
      .insert({
        customer_id: customer_id || null,
        business_id: routingResult.business_id,
        status: 'pending',
        order_type,
        details: {
          items: order_items,
          delivery_address
        },
        total_amount,
        currency: 'PLN',
        customer_notes,
        customer_type: customer_id ? 'registered' : 'guest',
        source_location: customer_location || {},
        routing_metadata: {
          auto_routed: true,
          routing_reason: routingResult.reason,
          distance_km: routingResult.distance_km || null,
          routing_timestamp: new Date().toISOString()
        }
      })
      .select()
      .single();

    if (orderError) {
      console.error('Order creation error:', orderError);
      return res.status(500).json({
        ok: false,
        error: "ORDER_CREATION_FAILED",
        message: "Nie udało się utworzyć zamówienia",
        details: orderError.message
      });
    }

    // Pobieranie informacji o restauracji
    const { data: business } = await supabase
      .from('businesses')
      .select('id, name, address, phone')
      .eq('id', routingResult.business_id)
      .single();

    return res.status(201).json({
      ok: true,
      message: "Zamówienie zostało pomyślnie przekierowane",
      data: {
        order_id: newOrder.id,
        business: business,
        routing_info: {
          reason: routingResult.reason,
          distance_km: routingResult.distance_km
        },
        estimated_delivery: calculateEstimatedDelivery(routingResult.distance_km)
      }
    });

  } catch (err) {
    console.error("ORDER_ROUTING error:", err);
    return res.status(500).json({ 
      ok: false, 
      error: "ORDER_ROUTING_INTERNAL", 
      message: "Błąd wewnętrzny serwera",
      detail: String(err?.message || err) 
    });
  }
}

// Funkcja kierowania zamówienia do odpowiedniej restauracji
async function routeOrderToBusiness({ order_items, customer_location, order_type }) {
  try {
    // 1. Identyfikacja kategorii biznesu na podstawie pozycji zamówienia
    const businessCategory = detectBusinessCategory(order_items);
    
    // 2. Jeśli mamy lokalizację klienta, szukamy najbliższych restauracji
    if (customer_location?.lat && customer_location?.lng) {
      const nearbyBusinesses = await findNearbyBusinesses(
        customer_location, 
        businessCategory,
        10 // radius w km
      );
      
      if (nearbyBusinesses.length > 0) {
        const closestBusiness = nearbyBusinesses[0];
        return {
          business_id: closestBusiness.id,
          reason: 'location_based',
          distance_km: closestBusiness.distance_km
        };
      }
    }
    
    // 3. Fallback - wybierz pierwszą dostępną restaurację danej kategorii
    const { data: availableBusinesses } = await supabase
      .from('businesses')
      .select('id, name')
      .eq('is_active', true)
      .eq('is_verified', true)
      .limit(1);
    
    if (availableBusinesses && availableBusinesses.length > 0) {
      return {
        business_id: availableBusinesses[0].id,
        reason: 'fallback_available',
        distance_km: null
      };
    }
    
    // 4. Brak dostępnych restauracji
    return {
      business_id: null,
      reason: 'no_businesses_available',
      distance_km: null
    };
    
  } catch (error) {
    console.error('Routing error:', error);
    return {
      business_id: null,
      reason: 'routing_error',
      distance_km: null
    };
  }
}

// Wykrywanie kategorii biznesu na podstawie pozycji zamówienia
function detectBusinessCategory(order_items) {
  const itemNames = order_items.map(item => item.name.toLowerCase()).join(' ');
  
  if (/pizza|margherita|pepperoni/.test(itemNames)) return 'pizzeria';
  if (/burger|frytki|mcdonalds|burger king/.test(itemNames)) return 'fast_food';
  if (/sushi|maki|sashimi/.test(itemNames)) return 'sushi';
  if (/curry|masala|tandoori/.test(itemNames)) return 'indian';
  
  return 'restaurant'; // domyślna kategoria
}

// Znajdowanie najbliższych restauracji (uproszczona wersja)
async function findNearbyBusinesses(customer_location, category, radius_km) {
  // W rzeczywistej implementacji użyłbym PostGIS do wyszukiwania geograficznego
  // Na potrzeby demo używam prostego zapytania
  
  const { data: businesses } = await supabase
    .from('businesses')
    .select('id, name, city, latitude, longitude')
    .eq('is_active', true)
    .eq('is_verified', true);
  
  if (!businesses) return [];
  
  // Obliczanie odległości (prosta formuła haversine)
  const businessesWithDistance = businesses
    .map(business => {
      if (!business.latitude || !business.longitude) return null;
      
      const distance = calculateDistance(
        customer_location.lat,
        customer_location.lng,
        business.latitude,
        business.longitude
      );
      
      return {
        ...business,
        distance_km: distance
      };
    })
    .filter(b => b !== null && b.distance_km <= radius_km)
    .sort((a, b) => a.distance_km - b.distance_km);
  
  return businessesWithDistance;
}

// Obliczanie odległości między dwoma punktami (formuła haversine)
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // promień Ziemi w km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// Obliczanie szacowanego czasu dostawy
function calculateEstimatedDelivery(distance_km) {
  if (!distance_km) return null;
  
  // Bazowy czas przygotowania + czas dostawy
  const prep_time_minutes = 30;
  const delivery_time_minutes = Math.max(10, distance_km * 3); // 3 min na km
  const total_minutes = prep_time_minutes + delivery_time_minutes;
  
  const estimated_time = new Date();
  estimated_time.setMinutes(estimated_time.getMinutes() + total_minutes);
  
  return estimated_time.toISOString();
}
