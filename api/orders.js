// /api/orders.js - Voice Order Processing with GPT Integration
import express from "express";
import { createClient } from "@supabase/supabase-js";

const app = express();
app.use(express.json());

// Supabase configuration
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Supabase credentials missing');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Text normalization for better matching
function normalize(text) {
  return text
    .toLowerCase()
    .replace(/[łŁ]/g, "l")
    .replace(/[ó]/g, "o")
    .replace(/[ś]/g, "s")
    .replace(/[żź]/g, "z")
    .replace(/[ć]/g, "c")
    .replace(/[ń]/g, "n")
    .replace(/\s+/g, " ")
    .trim();
}

// Parse quantity from user query
function parseQuantityAndQuery(userQuery) {
  let quantity = 1;
  let cleaned = userQuery;

  const match = userQuery.match(/(\d+)\s*x\s*(.+)/i);
  if (match) {
    quantity = parseInt(match[1]);
    cleaned = match[2];
  }

  return { quantity, cleaned };
}

// GPT Integration - Process voice commands
async function processVoiceCommandWithGPT(voiceCommand, restaurantId, userEmail) {
  try {
    console.log('🤖 Processing voice command with GPT:', { voiceCommand, restaurantId, userEmail });

    // Parse quantity and clean query
    const { quantity, cleaned } = parseQuantityAndQuery(voiceCommand);
    
    console.log('🎯 Extracted:', { dishName: cleaned, quantity });
    
    return {
      dishName: cleaned,
      quantity,
      action: 'add_to_cart'
    };
    
  } catch (error) {
    console.error('❌ GPT processing error:', error);
    throw error;
  }
}

// Find menu item with normalization
function findMenuItem(menu, query) {
  const normalizedQuery = normalize(query);
  return menu.find(item => normalize(item.name).includes(normalizedQuery));
}

// Search menu items
async function searchMenuItems(restaurantId, query) {
  try {
    const { data, error } = await supabase
      .from('menu_items')
      .select('id, name, price')
      .eq('restaurant_id', restaurantId);
    
    if (error) throw error;
    
    // Use normalization for better matching
    const menu = data || [];
    const foundItem = findMenuItem(menu, query);
    
    return foundItem ? [foundItem] : [];
  } catch (error) {
    console.error('❌ Menu search error:', error);
    return [];
  }
}

// Add item to cart (create order)
async function addToCart(dishName, quantity, restaurantId, userEmail) {
  try {
    console.log('🛒 Adding to cart:', { dishName, quantity, restaurantId, userEmail });
    
    // Find the dish in menu
    const menuItems = await searchMenuItems(restaurantId, dishName);
    
    if (menuItems.length === 0) {
      throw new Error(`Nie znaleziono "${dishName}" w menu`);
    }
    
    const menuItem = menuItems[0]; // Take first match
    const totalPrice = menuItem.price * quantity;
    
    // Create order in database
    const { data, error } = await supabase
      .from('orders')
      .insert({
        user_id: userEmail, // Using email as user_id for now
        restaurant_id: restaurantId,
        status: 'pending',
        total_price: totalPrice,
        // Note: items field removed as per previous fixes
      })
      .select()
      .single();
    
    if (error) throw error;
    
    console.log('✅ Order created:', data);
    
    return {
      success: true,
      order: data,
      message: `Dodano ${quantity}x ${menuItem.name} za ${totalPrice} zł`,
      menuItem: {
        name: menuItem.name,
        price: menuItem.price,
        quantity: quantity,
        total: totalPrice
      }
    };
    
  } catch (error) {
    console.error('❌ Add to cart error:', error);
    throw error;
  }
}

// Main orders endpoint
app.post('/api/orders', async (req, res) => {
  try {
    const { voice_command, restaurant_id, user_email } = req.body;
    
    console.log('📞 Orders API called:', { voice_command, restaurant_id, user_email });
    
    if (!voice_command) {
      return res.status(400).json({
        error: 'Missing voice_command',
        message: 'Brak komendy głosowej'
      });
    }
    
    if (!restaurant_id) {
      return res.status(400).json({
        error: 'Missing restaurant_id',
        message: 'Wybierz restaurację'
      });
    }
    
    // Process voice command with GPT
    const gptResult = await processVoiceCommandWithGPT(voice_command, restaurant_id, user_email);
    
    if (gptResult.action === 'add_to_cart') {
      // Add to cart
      const result = await addToCart(
        gptResult.dishName,
        gptResult.quantity,
        restaurant_id,
        user_email
      );
      
      return res.json({
        success: true,
        action: 'add_to_cart',
        message: result.message,
        order: result.order,
        menuItem: result.menuItem
      });
    }
    
    // Default response
    return res.json({
      success: true,
      action: 'processed',
      message: `Przetworzono komendę: "${voice_command}"`,
      gptResult
    });
    
  } catch (error) {
    console.error('❌ Orders API error:', error);
    return res.status(500).json({
      error: 'Orders API error',
      message: error.message || 'Wystąpił błąd podczas przetwarzania zamówienia'
    });
  }
});

// Health check
app.get('/api/orders', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Orders API is running',
    features: ['voice_commands', 'gpt_processing', 'menu_search', 'cart_management']
  });
});

export default app;
