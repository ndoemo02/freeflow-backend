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

// GPT Integration - Process voice commands
async function processVoiceCommandWithGPT(voiceCommand, restaurantId, userEmail) {
  try {
    console.log('🤖 Processing voice command with GPT:', { voiceCommand, restaurantId, userEmail });

    // For now, we'll use a simple rule-based approach
    // Later this can be replaced with actual GPT API call
    
    const command = voiceCommand.toLowerCase().trim();
    
    // Extract dish name and quantity
    let dishName = '';
    let quantity = 1;
    
    // Simple pattern matching
    const quantityMatch = command.match(/(\d+)\s*x?\s*/);
    if (quantityMatch) {
      quantity = parseInt(quantityMatch[1]);
    }
    
    // Remove quantity from command to get dish name
    dishName = command.replace(/(\d+)\s*x?\s*/, '').trim();
    
    // Common dish name mappings
    const dishMappings = {
      'pizza': 'pizza',
      'burger': 'burger',
      'frytki': 'frytki',
      'cola': 'cola',
      'gulasz': 'gulasz wieprzowy z knedlikiem',
      'pierogi': 'pierogi z mięsem',
      'sýr': 'smažený sýr',
      'zupa': 'zupa czosnkowa',
      'czosnkowa': 'zupa czosnkowa (česnečka)'
    };
    
    // Find best match
    for (const [key, value] of Object.entries(dishMappings)) {
      if (dishName.includes(key)) {
        dishName = value;
        break;
      }
    }
    
    console.log('🎯 Extracted:', { dishName, quantity });
    
    return {
      dishName,
      quantity,
      action: 'add_to_cart'
    };
    
  } catch (error) {
    console.error('❌ GPT processing error:', error);
    throw error;
  }
}

// Search menu items
async function searchMenuItems(restaurantId, query) {
  try {
    const { data, error } = await supabase
      .from('menu_items')
      .select('id, name, price')
      .eq('restaurant_id', restaurantId)
      .ilike('name', `%${query}%`);
    
    if (error) throw error;
    return data || [];
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
