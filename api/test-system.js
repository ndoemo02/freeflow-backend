import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';

// Initialize clients
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const ttsClient = new TextToSpeechClient();

export default async function testSystem(req, res) {
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

  const testResults = {
    timestamp: new Date().toISOString(),
    tests: [],
    overall: 'PASS'
  };

  try {
    console.log('🧪 Starting system tests...');

    // Test 1: Supabase Connection
    console.log('1️⃣ Testing Supabase connection...');
    try {
      const { data: restaurants, error } = await supabase.from('restaurants').select('*').limit(1);
      if (error) throw error;
      
      testResults.tests.push({
        name: 'Supabase Connection',
        status: 'PASS',
        message: `Connected successfully. Found ${restaurants?.length || 0} restaurants.`,
        data: restaurants?.[0] || null
      });
    } catch (error) {
      testResults.tests.push({
        name: 'Supabase Connection',
        status: 'FAIL',
        message: error.message,
        error: error.code
      });
      testResults.overall = 'FAIL';
    }

    // Test 2: OpenAI Connection
    console.log('2️⃣ Testing OpenAI connection...');
    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "You are a test assistant. Respond with 'OK' if you can hear me." },
          { role: "user", content: "Test message" }
        ],
        max_tokens: 10
      });

      const response = completion.choices[0].message.content;
      
      testResults.tests.push({
        name: 'OpenAI Connection',
        status: 'PASS',
        message: `Connected successfully. Response: "${response}"`,
        data: { model: 'gpt-4o-mini', response }
      });
    } catch (error) {
      testResults.tests.push({
        name: 'OpenAI Connection',
        status: 'FAIL',
        message: error.message,
        error: error.code
      });
      testResults.overall = 'FAIL';
    }

    // Test 3: Google Cloud TTS
    console.log('3️⃣ Testing Google Cloud TTS...');
    try {
      const request = {
        input: { text: 'Test message' },
        voice: { 
          languageCode: 'pl-PL', 
          name: 'pl-PL-Wavenet-A',
          ssmlGender: 'FEMALE'
        },
        audioConfig: { 
          audioEncoding: 'MP3',
          speakingRate: 1.0
        }
      };

      const [response] = await ttsClient.synthesizeSpeech(request);
      
      if (response.audioContent) {
        testResults.tests.push({
          name: 'Google Cloud TTS',
          status: 'PASS',
          message: `TTS working. Audio size: ${response.audioContent.length} bytes`,
          data: { audioSize: response.audioContent.length }
        });
      } else {
        throw new Error('No audio content received');
      }
    } catch (error) {
      testResults.tests.push({
        name: 'Google Cloud TTS',
        status: 'FAIL',
        message: error.message,
        error: error.code
      });
      testResults.overall = 'FAIL';
    }

    // Test 4: Database Operations
    console.log('4️⃣ Testing database operations...');
    try {
      // Test restaurants
      const { data: restaurants, error: restError } = await supabase.from('restaurants').select('*');
      if (restError) throw restError;

      // Test menu items
      const { data: menuItems, error: menuError } = await supabase.from('menu_items').select('*').limit(5);
      if (menuError) throw menuError;

      // Test orders
      const { data: orders, error: ordersError } = await supabase.from('orders').select('*').limit(5);
      if (ordersError) throw ordersError;

      testResults.tests.push({
        name: 'Database Operations',
        status: 'PASS',
        message: `All tables accessible. Restaurants: ${restaurants?.length || 0}, Menu items: ${menuItems?.length || 0}, Orders: ${orders?.length || 0}`,
        data: {
          restaurants: restaurants?.length || 0,
          menuItems: menuItems?.length || 0,
          orders: orders?.length || 0
        }
      });
    } catch (error) {
      testResults.tests.push({
        name: 'Database Operations',
        status: 'FAIL',
        message: error.message,
        error: error.code
      });
      testResults.overall = 'FAIL';
    }

    // Test 5: End-to-End Flow Simulation
    console.log('5️⃣ Testing end-to-end flow...');
    try {
      // Simulate voice input
      const testMessage = "Chciałbym zamówić pizzę margherita";
      const testUserId = "test@example.com";

      // Get restaurants
      const { data: restaurants } = await supabase.from('restaurants').select('*');
      const testRestaurant = restaurants?.[0];

      if (testRestaurant) {
        // Get menu items
        const { data: menuItems } = await supabase.from('menu_items').select('*').eq('restaurant_id', testRestaurant.id);
        const testMenuItem = menuItems?.[0];

        if (testMenuItem) {
          // Test GPT with real data
          const systemPrompt = `
          Jesteś Ekspertem Doradztwa FreeFlow. 
          DOSTĘPNE RESTAURACJE: ${restaurants.map(r => r.name).join(', ')}
          
          Odpowiedz krótko na: "${testMessage}"
          `;

          const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: testMessage }
            ],
            max_tokens: 100
          });

          const gptResponse = completion.choices[0].message.content;

          // Test order creation
          const orderData = {
            user_email: testUserId,
            restaurant_name: testRestaurant.name,
            item_name: testMenuItem.name,
            price: testMenuItem.price,
            quantity: 1,
            status: 'pending'
          };

          const { data: newOrder, error: orderError } = await supabase
            .from('orders')
            .insert([orderData])
            .select();

          if (orderError) throw orderError;

          // Clean up test order
          await supabase.from('orders').delete().eq('id', newOrder[0].id);

          testResults.tests.push({
            name: 'End-to-End Flow',
            status: 'PASS',
            message: `Complete flow working. GPT response: "${gptResponse.substring(0, 50)}..."`,
            data: {
              gptResponse: gptResponse.substring(0, 100),
              orderCreated: !!newOrder?.[0],
              restaurant: testRestaurant.name,
              menuItem: testMenuItem.name
            }
          });
        } else {
          throw new Error('No menu items found for testing');
        }
      } else {
        throw new Error('No restaurants found for testing');
      }
    } catch (error) {
      testResults.tests.push({
        name: 'End-to-End Flow',
        status: 'FAIL',
        message: error.message,
        error: error.code
      });
      testResults.overall = 'FAIL';
    }

    // Test 6: Environment Variables
    console.log('6️⃣ Testing environment variables...');
    const envVars = {
      SUPABASE_URL: !!process.env.SUPABASE_URL,
      SUPABASE_KEY: !!process.env.SUPABASE_KEY,
      OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
      GOOGLE_APPLICATION_CREDENTIALS_JSON: !!process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON
    };

    const missingVars = Object.entries(envVars).filter(([key, value]) => !value).map(([key]) => key);

    testResults.tests.push({
      name: 'Environment Variables',
      status: missingVars.length === 0 ? 'PASS' : 'FAIL',
      message: missingVars.length === 0 ? 'All required environment variables are set' : `Missing: ${missingVars.join(', ')}`,
      data: envVars
    });

    if (missingVars.length > 0) {
      testResults.overall = 'FAIL';
    }

    console.log('✅ System tests completed:', testResults.overall);

    res.status(200).json({
      ok: true,
      ...testResults
    });

  } catch (error) {
    console.error('❌ System test error:', error);
    
    testResults.overall = 'FAIL';
    testResults.tests.push({
      name: 'System Test',
      status: 'FAIL',
      message: error.message,
      error: error.code
    });

    res.status(500).json({
      ok: false,
      ...testResults
    });
  }
}
