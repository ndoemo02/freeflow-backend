import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import { applyCORS } from './_cors.js';

// Initialize clients
let ttsClient;
let openaiClient;
let supabaseClient;

// Initialize OpenAI client
function initializeOpenAI() {
  if (openaiClient) return openaiClient;
  
  try {
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    console.log('✅ OpenAI client initialized');
  } catch (error) {
    console.error('❌ OpenAI initialization error:', error);
    throw error;
  }
  
  return openaiClient;
}

// Initialize Supabase client
function initializeSupabase() {
  if (supabaseClient) return supabaseClient;
  
  try {
    supabaseClient = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_KEY
    );
    console.log('✅ Supabase client initialized');
  } catch (error) {
    console.error('❌ Supabase initialization error:', error);
    throw error;
  }
  
  return supabaseClient;
}

function initializeTtsClient() {
  if (ttsClient) return ttsClient;

  try {
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
      console.log('✅ Agent TTS: Using Vercel environment credentials (JSON)');
      const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
      ttsClient = new TextToSpeechClient({ credentials });
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64) {
      console.log('✅ Agent TTS: Using Vercel environment credentials (Base64)');
      const credentialsJson = Buffer.from(process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64, 'base64').toString('utf8');
      const credentials = JSON.parse(credentialsJson);
      ttsClient = new TextToSpeechClient({ credentials });
    } else {
      console.log('✅ Agent TTS: Using local service account file...');
      ttsClient = new TextToSpeechClient({
        keyFilename: './service-account.json'
      });
    }
  } catch (error) {
    console.error('❌ Agent TTS: Failed to initialize client:', error);
    throw error;
  }

  return ttsClient;
}

// Supabase helper functions
async function getRestaurants() {
  try {
    const supabase = initializeSupabase();
    const { data, error } = await supabase.from('restaurants').select('*');
    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('❌ Error fetching restaurants:', error);
    return [];
  }
}

async function getMenuItems(restaurantId) {
  try {
    const supabase = initializeSupabase();
    const { data, error } = await supabase
      .from('menu_items')
      .select('*')
      .eq('restaurant_id', restaurantId);
    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('❌ Error fetching menu items:', error);
    return [];
  }
}

async function createOrder(orderData) {
  try {
    const supabase = initializeSupabase();
    const { data, error } = await supabase
      .from('orders')
      .insert([orderData])
      .select();
    if (error) throw error;
    return data?.[0] || null;
  } catch (error) {
    console.error('❌ Error creating order:', error);
    throw error;
  }
}

async function getUserOrders(userEmail) {
  try {
    const supabase = initializeSupabase();
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .eq('user_email', userEmail)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('❌ Error fetching user orders:', error);
    return [];
  }
}

// Generate agent response using OpenAI with Supabase integration
async function generateAgentResponse(message, context = "", userId = null) {
  try {
    const openai = initializeOpenAI();
    
    // Get real data from Supabase
    const restaurants = await getRestaurants();
    const userOrders = userId ? await getUserOrders(userId) : [];
    
    // Build context with real data
    const restaurantsList = restaurants.map(r => `${r.name} (${r.cuisine_type || 'restauracja'})`).join(', ');
    const recentOrders = userOrders.slice(0, 3).map(o => `${o.item_name} z ${o.restaurant_name}`).join(', ');
    
    const systemPrompt = `
    Jesteś Ekspertem Doradztwa FreeFlow — inteligentnym asystentem 
    wspierającym w personalizacji usług gastronomicznych, transportowych 
    (taksówkarskich) oraz hotelarsko-wypoczynkowych. 
    Pomagasz zarówno klientom indywidualnym, jak i firmowym.

    DOSTĘPNE RESTAURACJE: ${restaurantsList}
    OSTATNIE ZAMÓWIENIA: ${recentOrders || 'brak'}
    
    Twoje zadania:
    - Analizuj potrzeby użytkownika i proponuj konkretne rozwiązania z dostępnych restauracji.
    - Uwzględniaj lokalny kontekst i preferencje (np. Katowice, Piekary Śląskie).
    - Bądź naturalny, profesjonalny i rzeczowy, ale nie sztywny.
    - Możesz proponować współpracę z lokalnymi firmami.
    - Zawsze kończ odpowiedź konkretną rekomendacją lub kolejnym pytaniem kontekstowym.
    - Odpowiadaj krótko i konkretnie (max 2-3 zdania).
    - Jeśli użytkownik chce zamówić jedzenie, zaproponuj konkretne restauracje z listy.

    Kontekst rozmowy: ${context || "brak"}
    `;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: message },
      ],
      temperature: 0.8,
      max_tokens: 200,
    });

    const responseText = completion.choices[0].message.content;
    
    // Determine action and execute if needed
    let action = "general_help";
    let confidence = 0.8;
    let supabaseAction = null;
    
    const lowerMessage = message.toLowerCase();
    const lowerResponse = responseText.toLowerCase();
    
    // Check for food ordering intent
    if (lowerMessage.includes('zamów') || lowerMessage.includes('zamow') || 
        lowerMessage.includes('pizza') || lowerMessage.includes('burger') ||
        lowerMessage.includes('jedzenie') || lowerMessage.includes('menu')) {
      
      action = "food_order";
      
      // Try to extract restaurant and item from message
      const restaurantMatch = restaurants.find(r => 
        lowerMessage.includes(r.name.toLowerCase())
      );
      
      if (restaurantMatch) {
        const menuItems = await getMenuItems(restaurantMatch.id);
        const itemMatch = menuItems.find(item => 
          lowerMessage.includes(item.name.toLowerCase())
        );
        
        if (itemMatch && userId) {
          // Create order in Supabase
          try {
            const orderData = {
              user_email: userId,
              restaurant_name: restaurantMatch.name,
              item_name: itemMatch.name,
              price: itemMatch.price,
              quantity: 1,
              status: 'pending'
            };
            
            const order = await createOrder(orderData);
            supabaseAction = {
              type: 'order_created',
              order: order,
              message: `Zamówiłem ${itemMatch.name} z ${restaurantMatch.name} za ${itemMatch.price} zł.`
            };
            
            console.log('✅ Order created via Supabase:', order);
          } catch (error) {
            console.error('❌ Error creating order:', error);
          }
        }
      }
    } else if (lowerMessage.includes('status') || lowerMessage.includes('zamówienie') || lowerMessage.includes('zamowienie')) {
      action = "order_status";
      
      if (userId) {
        const orders = await getUserOrders(userId);
        if (orders.length > 0) {
          const latestOrder = orders[0];
          supabaseAction = {
            type: 'order_status',
            orders: orders,
            message: `Twoje ostatnie zamówienie: ${latestOrder.item_name} z ${latestOrder.restaurant_name} - status: ${latestOrder.status}`
          };
        }
      }
    } else if (lowerResponse.includes('taxi') || lowerResponse.includes('taksówka')) {
      action = "taxi_booking";
    } else if (lowerResponse.includes('hotel') || lowerResponse.includes('nocleg')) {
      action = "hotel_booking";
    }
    
    return {
      text: supabaseAction ? supabaseAction.message : responseText,
      action: action,
      confidence: confidence,
      supabaseAction: supabaseAction
    };
    
  } catch (error) {
    console.error('❌ OpenAI error:', error);
    
    // Fallback to simple responses
    const lowerMessage = message.toLowerCase();
    
    if (lowerMessage.includes('pizza') || lowerMessage.includes('zamów')) {
      return {
        text: "Świetnie! Chciałbyś zamówić pizzę. Jaką pizzę preferujesz?",
        action: "food_order",
        confidence: 0.9
      };
    }
    
    if (lowerMessage.includes('taxi') || lowerMessage.includes('taksówka')) {
      return {
        text: "Oczywiście! Pomogę Ci zamówić taksówkę. Gdzie chciałbyś się udać?",
        action: "taxi_booking",
        confidence: 0.9
      };
    }
    
    return {
      text: "Rozumiem. Czy mogę pomóc Ci z zamówieniem jedzenia, taksówki lub rezerwacją hotelu?",
      action: "general_help",
      confidence: 0.6
    };
  }
}

// Generate TTS audio for response
async function generateTtsAudio(text) {
  try {
    const client = initializeTtsClient();
    
    const request = {
      input: { text },
      voice: { 
        languageCode: 'pl-PL', 
        name: 'pl-PL-Wavenet-A',
        ssmlGender: 'FEMALE'
      },
      audioConfig: { 
        audioEncoding: 'MP3',
        speakingRate: 1.0,
        pitch: 0.0
      }
    };

    const [response] = await client.synthesizeSpeech(request);
    
    if (!response.audioContent) {
      throw new Error('No audio content received from Google Cloud TTS');
    }
    
    return response.audioContent.toString('base64');
  } catch (error) {
    console.error('❌ TTS generation error:', error);
    return null;
  }
}

export default async function agent(req, res) {
  if (applyCORS(req, res)) return; // 👈 ważne: obsługuje preflight

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { message, sessionId, userId, timestamp, context } = req.body;

    if (!message) {
      return res.status(400).json({ 
        error: 'Missing message parameter' 
      });
    }

    console.log('🤖 Agent processing:', { 
      message: message.substring(0, 100) + '...', 
      sessionId, 
      userId,
      timestamp,
      context: context || 'brak'
    });

    // Generate agent response using OpenAI with Supabase
    const agentResponse = await generateAgentResponse(message, context, userId);
    
    console.log('🤖 Agent response:', agentResponse);

    // Generate TTS audio
    const audioContent = await generateTtsAudio(agentResponse.text);
    
    const response = {
      ok: true,
      sessionId: sessionId || `session_${Date.now()}`,
      userId: userId || 'anonymous',
      timestamp: timestamp || new Date().toISOString(),
      userMessage: message,
      agentResponse: {
        text: agentResponse.text,
        action: agentResponse.action,
        confidence: agentResponse.confidence,
        supabaseAction: agentResponse.supabaseAction
      },
      audioContent: audioContent,
      audioEncoding: 'MP3'
    };

    console.log('✅ Agent response ready, audio size:', audioContent ? audioContent.length : 'none');

    res.status(200).json(response);

  } catch (error) {
    console.error('❌ Agent error:', error);
    
    res.status(500).json({
      ok: false,
      error: 'AGENT_ERROR',
      message: error.message,
      sessionId: req.body.sessionId || `session_${Date.now()}`
    });
  }
}
