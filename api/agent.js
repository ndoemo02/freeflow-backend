import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import OpenAI from 'openai';

// Initialize TTS client
let ttsClient;
let openaiClient;

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
      console.log('⚠️ Agent TTS: Trying default Google Cloud credentials...');
      ttsClient = new TextToSpeechClient();
    }
  } catch (error) {
    console.error('❌ Agent TTS: Failed to initialize client:', error);
    throw error;
  }

  return ttsClient;
}

// Generate agent response using OpenAI
async function generateAgentResponse(message, context = "") {
  try {
    const openai = initializeOpenAI();
    
    const systemPrompt = `
    Jesteś Ekspertem Doradztwa FreeFlow — inteligentnym asystentem 
    wspierającym w personalizacji usług gastronomicznych, transportowych 
    (taksówkarskich) oraz hotelarsko-wypoczynkowych. 
    Pomagasz zarówno klientom indywidualnym, jak i firmowym.

    Twoje zadania:
    - Analizuj potrzeby użytkownika i proponuj konkretne rozwiązania (restauracje, trasy, hotele).
    - Uwzględniaj lokalny kontekst i preferencje (np. Katowice, Piekary Śląskie).
    - Bądź naturalny, profesjonalny i rzeczowy, ale nie sztywny.
    - Możesz proponować współpracę z lokalnymi firmami.
    - Zawsze kończ odpowiedź konkretną rekomendacją lub kolejnym pytaniem kontekstowym.
    - Odpowiadaj krótko i konkretnie (max 2-3 zdania).

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
    
    // Determine action based on response content
    let action = "general_help";
    let confidence = 0.8;
    
    const lowerResponse = responseText.toLowerCase();
    if (lowerResponse.includes('zamów') || lowerResponse.includes('zamow')) {
      action = "food_order";
    } else if (lowerResponse.includes('taxi') || lowerResponse.includes('taksówka')) {
      action = "taxi_booking";
    } else if (lowerResponse.includes('hotel') || lowerResponse.includes('nocleg')) {
      action = "hotel_booking";
    } else if (lowerResponse.includes('status') || lowerResponse.includes('zamówienie')) {
      action = "order_status";
    }
    
    return {
      text: responseText,
      action: action,
      confidence: confidence
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

    // Generate agent response using OpenAI
    const agentResponse = await generateAgentResponse(message, context);
    
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
        confidence: agentResponse.confidence
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
