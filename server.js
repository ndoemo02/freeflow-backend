
// --- SAFE DOTENV LOADER ---
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

// Wymuś absolutną ścieżkę do pliku .env w tym katalogu
const envPath = path.resolve(process.cwd(), ".env");

// Sprawdź, czy plik istnieje i załaduj
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
  console.log("🌍 Loaded .env from:", envPath);
  console.log("🔑 SUPABASE_URL:", process.env.SUPABASE_URL || "(not found)");
} else {
  console.warn("⚠️  No .env file found at:", envPath);
}

// ✅ --- FreeFlow Startup Watchdog ---
import os from "os";
import { execSync } from "child_process";

// 🔹 Wczytaj wersję z package.json
let version = "unknown";
try {
  const pkg = JSON.parse(fs.readFileSync("./package.json", "utf8"));
  version = pkg.version || "unversioned";
} catch (err) {
  version = "missing package.json";
}

// 🔹 Pobierz ostatni commit z Git (jeśli istnieje repo)
let gitInfo = "no git data";
try {
  gitInfo = execSync("git log -1 --pretty=format:\"%h - %s (%ci)\"").toString().trim();
} catch {
  gitInfo = "git not initialized";
}

// 🔹 System info
console.log("\n🧠 Initializing FreeFlow Watchdog...");
console.log("──────────────────────────────────────────────");
console.log(`📦 Version: ${version}`);
console.log(`💾 Git: ${gitInfo}`);
console.log(`📦 Node: ${process.version}`);
console.log(`💻 Host: ${os.hostname()}`);
console.log(`📂 Working dir: ${process.cwd()}`);
console.log("──────────────────────────────────────────────");

// 🔹 Sprawdzenie ENV
const env = {
  SUPABASE_URL: process.env.SUPABASE_URL || "❌ missing",
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ? "✅ loaded" : "❌ missing",
  OPENAI_API_KEY: process.env.OPENAI_API_KEY ? "✅ loaded" : "⚠️ missing",
  GOOGLE_TTS_API_KEY: process.env.GOOGLE_TTS_API_KEY ? "✅ loaded" : "⚠️ missing",
  GEMINI_API_KEY: process.env.GEMINI_API_KEY ? "✅ loaded" : "⚠️ missing",
};

console.log("🌍 ENV CHECK:");
console.table(env);

// 🔹 Ostrzeżenia
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.warn("🚨 Supabase credentials missing — backend may fail to fetch restaurants!");
}
if (!process.env.OPENAI_API_KEY) {
  console.warn("⚠️ OpenAI key not found — AI brain responses may be disabled!");
}
if (!process.env.GOOGLE_TTS_API_KEY) {
  console.warn("⚠️ TTS key missing — voice output will not work!");
}

console.log("──────────────────────────────────────────────");
console.log("✅ FreeFlow Watchdog initialized successfully.\n");

import express from "express";
import { createClient } from "@supabase/supabase-js";
import { createServer } from 'http';
import { WebSocketServer } from 'ws';

import OpenAI from "openai";
import multer from "multer";
import cors from "cors";
import speech from "@google-cloud/speech";
import textToSpeech from "@google-cloud/text-to-speech";
import { ALLOWED_HEADERS, isAllowedOrigin } from "./api/_cors.js";
// test-flow.js removed for Vercel compatibility


const app = express();

app.use(express.json());

// --- CORS FIX (dla Vercel i lokalnie) ---
app.use(cors({
  origin(origin, callback) {
    // Pozwala na brak nagłówka origin przy testach np. z Postmana
    if (!origin) return callback(null, true);
    if (isAllowedOrigin(origin)) {
      return callback(null, true);
    }
    console.warn(`🚨 CORS blocked origin: ${origin}`);
    return callback(new Error("CORS policy violation"), false);
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ALLOWED_HEADERS,
  credentials: true,
  optionsSuccessStatus: 200
}));

app.use(express.json());

// kompatybilność: GET /api?endpoint=health oraz POST /api { endpoint: "health" }
app.all('/api', (req, res, next) => {
  const ep = (req.query.endpoint || req.body?.endpoint || '').toString();

  if (ep === 'health') {
    return res.json({ ok: true, ts: new Date().toISOString() });
  }

  return res.status(404).send('Unknown /api endpoint');
});

// CORS is handled by the cors middleware above

// Initialize clients inside functions to ensure env vars are loaded
let openai, sttClient, ttsClient;

const initClients = () => {
  if (!openai) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || 'dummy-key' });
    
    // Use credentials for Vercel, file path for local development
    if (process.env.GOOGLE_VOICEORDER_KEY_B64) {
      // Vercel deployment - use base64 encoded JSON from environment variable
      const credentialsJson = Buffer.from(process.env.GOOGLE_VOICEORDER_KEY_B64, 'base64').toString('utf-8');
      const credentials = JSON.parse(credentialsJson);
      
      sttClient = new speech.SpeechClient({
        credentials: credentials
      });
      ttsClient = new textToSpeech.TextToSpeechClient({
        credentials: credentials
      });
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64) {
      // Fallback: Vercel deployment - use base64 encoded JSON from environment variable
      const credentialsJson = Buffer.from(process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64, 'base64').toString('utf-8');
      const credentials = JSON.parse(credentialsJson);
      
      sttClient = new speech.SpeechClient({
        credentials: credentials
      });
      ttsClient = new textToSpeech.TextToSpeechClient({
        credentials: credentials
      });
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
      // Fallback: Vercel deployment - use JSON from environment variable
      const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
      
      // Fix private key formatting (replace \n with actual newlines)
      if (credentials.private_key) {
        credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
      }
      
      sttClient = new speech.SpeechClient({
        credentials: credentials
      });
      ttsClient = new textToSpeech.TextToSpeechClient({
        credentials: credentials
      });
    } else {
      // Local development - use file path
      const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || './FreeFlow.json';
      sttClient = new speech.SpeechClient({
        keyFilename: credentialsPath
      });
      ttsClient = new textToSpeech.TextToSpeechClient({
        keyFilename: credentialsPath
      });
    }
  }
};

const upload = multer({ storage: multer.memoryStorage() });

// TTS endpoint (before test-flow router)
app.post("/api/tts", async (req, res) => {
  initClients();
  
  try {
    const { text, languageCode = 'pl-PL', voice = 'pl-PL-Standard-A' } = req.body;
    if (!text) return res.status(400).json({ error: "Missing text field" });

    const request = {
      input: { text },
      voice: { languageCode, name: voice },
      audioConfig: { audioEncoding: 'MP3' },
    };

    console.log("🎤 Generating voice for:", text);
    const [response] = await ttsClient.synthesizeSpeech(request);

    if (!response.audioContent) throw new Error("Empty audio content from Google TTS");

    const audioBuffer = Buffer.from(response.audioContent, 'base64');
    res.setHeader('Content-Type', 'audio/mpeg');
    res.status(200).send(audioBuffer);

  } catch (error) {
    console.error("❌ TTS handler error:", error.message);
    res.status(500).json({
      ok: false,
      error: 'TTS_ERROR',
      message: error.message,
      hint: 'Check Google credentials or API quota'
    });
  }
});

// Chirp HD TTS endpoint
app.post("/api/tts-chirp-hd", async (req, res) => {
  try {
    const chirpHDHandler = await import('./api/tts-chirp-hd.js');
    return chirpHDHandler.default(req, res);
  } catch (error) {
    console.error('❌ Chirp HD TTS error:', error);
    res.status(500).json({ error: 'Chirp HD TTS failed' });
  }
});

// Chirp Live Stream TTS endpoint
app.post("/api/tts-chirp-stream", async (req, res) => {
  try {
    const chirpStreamHandler = await import('./api/tts-chirp-stream.js');
    return chirpStreamHandler.default(req, res);
  } catch (error) {
    console.error('❌ Chirp Live Stream TTS error:', error);
    res.status(500).json({ error: 'Chirp Live Stream TTS failed' });
  }
});

// OpenAI Realtime endpoint
app.post("/api/realtime-freeflow", async (req, res) => {
  try {
    const realtimeHandler = await import('./api/realtime-freeflow.js');
    return realtimeHandler.default(req, res);
  } catch (error) {
    console.error('❌ OpenAI Realtime error:', error);
    res.status(500).json({ error: 'OpenAI Realtime failed' });
  }
});

// FreeFlow Brain endpoint - now using Amber Brain for location-based recommendations
app.post("/api/brain", async (req, res) => {
  try {
    const amberBrain = await import('./api/brain/amber.js');
    return amberBrain.default(req, res);
  } catch (err) {
    console.error('Brain endpoint error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Amber Context endpoint for status tracking
app.get("/api/brain/context", async (req, res) => {
  try {
    const contextHandler = await import('./api/brain/context.js');
    return contextHandler.default(req, res);
  } catch (err) {
    console.error('Context endpoint error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/brain/context", async (req, res) => {
  try {
    const contextHandler = await import('./api/brain/context.js');
    return contextHandler.default(req, res);
  } catch (err) {
    console.error('Context endpoint error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Amber Training endpoint
app.post("/api/brain/train", async (req, res) => {
  try {
    const { phrase, intent } = req.body;
    if (!phrase || !intent) {
      return res.status(400).json({ ok: false, error: 'Missing phrase or intent' });
    }
    
    const { trainIntent } = await import('./api/brain/intent-router.js');
    await trainIntent(phrase, intent);
    
    res.json({ ok: true, message: 'Amber trained successfully' });
  } catch (err) {
    console.error('Training error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Brain Router endpoint - nowy zaawansowany system
app.post("/api/brain/router", async (req, res) => {
  try {
    const brainRouter = await import('./api/brain/brainRouter.js');
    return brainRouter.default(req, res);
  } catch (err) {
    console.error('Brain Router endpoint error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Stats endpoint - statystyki jakości sesji
app.get("/api/brain/stats", async (req, res) => {
  try {
    const stats = await import('./api/brain/stats.js');
    return stats.default(req, res);
  } catch (err) {
    console.error('Stats endpoint error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Create Order endpoint - nowy endpoint dla zamówień
app.post("/api/orders", async (req, res) => {
  try {
    const orders = await import('./api/orders.js');
    return orders.createOrderEndpoint(req, res);
  } catch (err) {
    console.error('Create Order endpoint error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Debug endpoints removed for Vercel compatibility

// Sessions API endpoint
app.post("/api/sessions", async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS.join(', '));
  
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { action, sessionId, userId, message, eventType, data } = req.body;

    // Initialize Supabase client
    const { supabase } = await import('./api/_supabase.js');

    switch (action) {
      case 'create_session':
        const { data: session, error: sessionError } = await supabase
          .from('sessions')
          .insert([{
            id: sessionId,
            user_id: userId,
            created_at: new Date().toISOString(),
            status: 'active'
          }])
          .select();
        
        if (sessionError) throw sessionError;
        return res.status(200).json({ ok: true, session });

      case 'save_message':
        const { data: messageData, error: messageError } = await supabase
          .from('messages')
          .insert([{
            session_id: sessionId,
            user_id: userId,
            content: message.content,
            role: message.role, // 'user' or 'assistant'
            timestamp: new Date().toISOString()
          }])
          .select();
        
        if (messageError) throw messageError;
        return res.status(200).json({ ok: true, message: messageData });

      case 'log_event':
        const { data: eventData, error: eventError } = await supabase
          .from('events')
          .insert([{
            session_id: sessionId,
            user_id: userId,
            event_type: eventType,
            data: data,
            timestamp: new Date().toISOString()
          }])
          .select();
        
        if (eventError) throw eventError;
        return res.status(200).json({ ok: true, event: eventData });

      case 'get_session_history':
        const { data: history, error: historyError } = await supabase
          .from('messages')
          .select('*')
          .eq('session_id', sessionId)
          .order('timestamp', { ascending: true });
        
        if (historyError) throw historyError;
        return res.status(200).json({ ok: true, history });

      default:
        return res.status(400).json({ ok: false, error: 'Invalid action' });
    }
  } catch (error) {
    console.error('❌ Sessions API error:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

// Use test flow router
// testFlowRouter removed for Vercel compatibility

// Add agent endpoint
app.post("/api/agent", async (req, res) => {
  initClients();
  
  try {
    const { message, sessionId, userId, context } = req.body;

    if (!message) {
      return res.status(400).json({ 
        error: 'Missing message parameter' 
      });
    }

    console.log('🤖 Agent processing:', { 
      message: message.substring(0, 100) + '...', 
      sessionId, 
      userId,
      context: context || 'brak'
    });

    // Simple agent response using OpenAI
    const systemPrompt = `
    Jesteś Ekspertem Doradztwa FreeFlow — inteligentnym asystentem 
    wspierającym w personalizacji usług gastronomicznych, transportowych 
    (taksówkarskich) oraz hotelarsko-wypoczynkowych. 
    Pomagasz zarówno klientom indywidualnym, jak i firmowym.

    Twoje zadania:
    - Analizuj potrzeby użytkownika i proponuj konkretne rozwiązania.
    - Uwzględniaj lokalny kontekst i preferencje (np. Katowice, Piekary Śląskie).
    - Bądź naturalny, profesjonalny i rzeczowy, ale nie sztywny.
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
    
    // Generate TTS audio
    const [ttsResponse] = await ttsClient.synthesizeSpeech({
      input: { text: responseText },
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
    });

    const audioContent = ttsResponse.audioContent ? ttsResponse.audioContent.toString('base64') : null;
    
    const response = {
      ok: true,
      sessionId: sessionId || `session_${Date.now()}`,
      userId: userId || 'anonymous',
      timestamp: new Date().toISOString(),
      userMessage: message,
      agentResponse: {
        text: responseText,
        action: "general_help",
        confidence: 0.8
      },
      audioContent: audioContent,
      audioEncoding: 'MP3'
    };

    console.log('✅ Agent response ready, audio size:', audioContent ? audioContent.length : 'none');
    res.status(200).json(response);

  } catch (err) {
    console.error("❌ Agent error:", err);
    res.status(500).json({ 
      ok: false,
      error: "Agent error", 
      message: err.message 
    });
  }
});

// Add direct STT endpoint for frontend proxy
app.post("/api/stt", upload.single("audio"), async (req, res) => {
  initClients();
  
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: "No audio file provided" });
    }

    const audioBytes = req.file.buffer.toString("base64");

    const [response] = await sttClient.recognize({
      audio: { content: audioBytes },
      config: {
        encoding: "WEBM_OPUS",
        languageCode: "pl-PL",
        model: "default",
      },
    });

    const transcription = response.results.map(r => r.alternatives[0].transcript).join("\n");
    console.log("🎙️ API STT Transkrypcja:", transcription);
    res.json({ ok: true, text: transcription });
  } catch (err) {
    console.error("❌ API STT Błąd:", err);
    res.status(500).json({ ok: false, error: "Błąd transkrypcji głosu" });
  }
});

// === [1] SPEECH → TEXT ===
app.post("/stt", upload.single("audio"), async (req, res) => {
  initClients();
  
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No audio file provided" });
    }

    const audioBytes = req.file.buffer.toString("base64");

    const [response] = await sttClient.recognize({
      audio: { content: audioBytes },
      config: {
        encoding: "WEBM_OPUS",
        languageCode: "pl-PL",
        model: "default",
      },
    });

    const transcription = response.results.map(r => r.alternatives[0].transcript).join("\n");
    console.log("🎙️ Transkrypcja:", transcription);
    res.json({ text: transcription });
  } catch (err) {
    console.error("❌ Błąd STT:", err);
    res.status(500).json({ error: "Błąd transkrypcji głosu" });
  }
});

// === [2] GPT EXPERT ===
app.post("/expert", async (req, res) => {
  initClients();
  
  try {
    const { query, context } = req.body;

    const systemPrompt = `
    Jesteś Ekspertem Doradztwa FreeFlow — inteligentnym asystentem 
    personalizacji usług gastronomicznych, przewozowych i hotelarskich.
    Doradzasz klientom w oparciu o lokalne dane i potrzeby.
    Zawsze kończ odpowiedź konkretnym rozwiązaniem.
    `;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: query },
      ],
    });

    const response = completion.choices[0].message.content;
    console.log("🧠 GPT:", response);
    res.json({ response });
  } catch (err) {
    console.error("❌ Błąd eksperta:", err);
    res.status(500).json({ error: "Błąd przetwarzania GPT" });
  }
});

// === [3] TEXT → SPEECH ===
app.post("/tts", async (req, res) => {
  initClients();
  
  try {
    const { text } = req.body;

    const [response] = await ttsClient.synthesizeSpeech({
      input: { text },
      voice: { languageCode: "pl-PL", name: "pl-PL-Wavenet-A" },
      audioConfig: { audioEncoding: "MP3", speakingRate: 1.05 },
    });

    console.log("🔊 Wygenerowano TTS z Google Cloud");
    res.json({ 
      audioContent: response.audioContent.toString('base64')
    });
  } catch (err) {
    console.error("❌ Błąd TTS:", err);
    res.status(500).json({ error: "Błąd generowania głosu" });
  }
});

// === [4] REALTIME TOKEN ENDPOINT ===
app.get("/api/realtime-token", async (req, res) => {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Brak klucza OPENAI_API_KEY w środowisku" });
    }
    res.status(200).json({ apiKey });
  } catch (err) {
    console.error("❌ Błąd realtime-token:", err);
    res.status(500).json({ error: err.message });
  }
});

// === [5] RESTAURANTS ENDPOINT ===
app.get("/api/restaurants", async (req, res) => {
  try {
    const { supabase } = await import('./api/_supabase.js');
    console.log("🔍 Fetching restaurants...");

    const { data, error } = await supabase
      .from("restaurants")
      .select("id, name, address, lat, lng");

    if (error) {
      console.error("❌ Supabase query error:", error);
      return res.status(500).json({ error: error.message });
    }

    console.log(`✅ Fetched ${data.length} restaurants`);
    res.json({ restaurants: data });
  } catch (err) {
    console.error("🔥 API /restaurants fatal error:", err);
    res.status(500).json({ error: err.message });
  }
});

// === [5.1] RESTAURANTS NEARBY ENDPOINT ===
app.get("/api/restaurants/nearby", async (req, res) => {
  try {
    const { lat, lng, radius = 2 } = req.query;

    if (!lat || !lng) {
      return res.status(400).json({ error: "Missing lat/lng parameters" });
    }

    const { supabase } = await import('./api/_supabase.js');
    console.log(`🔍 Finding restaurants near ${lat}, ${lng} within ${radius}km...`);

    const { data: restaurants, error } = await supabase
      .from("restaurants")
      .select("id, name, address, lat, lng");

    if (error) {
      console.error("❌ Supabase query error:", error);
      return res.status(500).json({ error: error.message });
    }

    // Funkcja licząca dystans między punktami (Haversine formula)
    function calculateDistance(lat1, lon1, lat2, lon2) {
      const R = 6371; // promień Ziemi w km
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) *
        Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) ** 2;
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return R * c;
    }

    const nearby = restaurants
      .map((r) => ({
        ...r,
        distance_km: r.lat && r.lng ? calculateDistance(lat, lng, r.lat, r.lng) : null,
      }))
      .filter((r) => r.distance_km !== null && r.distance_km <= radius)
      .sort((a, b) => a.distance_km - b.distance_km);

    console.log(`✅ Found ${nearby.length} restaurants within ${radius}km`);
    res.json({ nearby });
  } catch (err) {
    console.error("🔥 API /restaurants/nearby fatal error:", err);
    res.status(500).json({ error: err.message });
  }
});

// === [6] MENU ENDPOINT ===
app.get("/api/menu/:restaurantId", async (req, res) => {
  try {
    const { restaurantId } = req.params;
    
    // Initialize Supabase client
    const { supabase } = await import('./api/_supabase.js');

    const { data: menuItems, error } = await supabase
      .from('menu_items')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .eq('available', true)
      .order('category, name');

    if (error) {
      console.error("❌ Błąd pobierania menu:", error);
      return res.status(500).json({ error: "Błąd pobierania menu" });
    }

    console.log(`🍕 Pobrano ${menuItems?.length || 0} pozycji menu dla restauracji ${restaurantId}`);
    res.json({ menuItems: menuItems || [] });
  } catch (err) {
    console.error("❌ Błąd menu endpoint:", err);
    res.status(500).json({ error: err.message });
  }
});

// === [7] ORDERS ENDPOINT ===
app.get("/api/orders", async (req, res) => {
  try {
    const ordersHandler = await import('./api/orders.js');
    return ordersHandler.default(req, res);
  } catch (error) {
    console.error('❌ Orders GET error:', error);
    res.status(500).json({ error: 'Orders GET failed' });
  }
});

app.delete("/api/orders", async (req, res) => {
  try {
    const ordersHandler = await import('./api/orders.js');
    return ordersHandler.default(req, res);
  } catch (error) {
    console.error('❌ Orders DELETE error:', error);
    res.status(500).json({ error: 'Orders DELETE failed' });
  }
});

app.post("/api/orders", async (req, res) => {
  try {
    const { message, restaurant_name, user_email } = req.body;
    console.log("🟡 ORDER INPUT:", { message, restaurant_name, user_email });

    // Get user_id from Supabase Auth if available
    let user_id = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const { supabase } = await import('./api/_supabase.js');
        const token = authHeader.substring(7);
        const { data: { user }, error } = await supabase.auth.getUser(token);
        if (user && !error) {
          user_id = user.id;
          console.log("✅ User authenticated:", user.email, "ID:", user_id);
        }
      } catch (authError) {
        console.log("⚠️ Auth error:", authError.message);
      }
    }

    // Initialize Supabase client
    const { supabase } = await import('./api/_supabase.js');

    // Pobierz restauracje
    console.log("🏪 Pobieram listę restauracji...");
    const { data: restaurants, error: restErr } = await supabase.from("restaurants").select("*");
    if (restErr) throw restErr;
    console.log(`📋 Znaleziono ${restaurants?.length || 0} restauracji`);

    // Find restaurant
    const restMatch = restaurants.find(r => 
      r.name.toLowerCase().includes(restaurant_name.toLowerCase())
    );
    if (!restMatch) {
      console.warn("❌ Nie znaleziono restauracji:", restaurant_name);
      return res.json({ reply: `Nie mogę znaleźć restauracji "${restaurant_name}".` });
    }

    console.log("✅ Restauracja dopasowana:", restMatch.name, "(ID:", restMatch.id, ")");

    // Pobierz menu restauracji
    console.log("🍽️ Pobieram menu dla restauracji:", restMatch.id);
    const { data: menu, error: menuErr } = await supabase
      .from("menu_items")
      .select("*")
      .eq("restaurant_id", restMatch.id);

    if (menuErr || !menu?.length) {
      console.warn("❌ Brak menu dla:", restMatch.name, "Błąd:", menuErr);
      return res.json({ reply: `Nie znalazłem menu dla "${restMatch.name}".` });
    }

    console.log(`📋 Znaleziono ${menu.length} pozycji w menu`);

    // Parse quantity
    let quantity = 1;
    let cleaned = message;
    const match = message.match(/(\d+)\s*x\s*(.+)/i);
    if (match) {
      quantity = parseInt(match[1]);
      cleaned = match[2];
      console.log(`🔢 Parsowanie ilości: "${message}" → ${quantity}x "${cleaned}"`);
    }

    // Find menu item
    console.log("🔍 Szukam pozycji w menu...");
    const item = menu.find(m => 
      m.name.toLowerCase().includes(cleaned.toLowerCase())
    );
    if (!item) {
      console.warn("❌ Brak pozycji:", cleaned);
      return res.json({ reply: `Nie znalazłem "${cleaned}" w menu. Spróbuj powiedzieć np. "pizza" lub "burger".` });
    }

    console.log("✅ Pozycja dopasowana:", item.name, "-", item.price_cents/100, "zł");

    // Create order
    console.log("💾 Tworzę zamówienie w bazie danych...");
    const orderData = {
      user_id, // Use user_id from Supabase Auth
      restaurant_id: restMatch.id,
      total_price: (item.price_cents || 2500) * quantity, // Fallback: 25 zł
      status: "pending",
    };
    
    console.log("📝 Dane zamówienia:", orderData);
    
    const { data: order, error: orderErr } = await supabase.from("orders").insert([orderData]).select();

    if (orderErr) {
      console.error("❌ Błąd tworzenia zamówienia:", orderErr);
      throw orderErr;
    }

    console.log("✅ Zamówienie utworzone:", order[0]?.id);

    const response = {
      reply: `Zamówiłem ${quantity}x ${item.name} w ${restMatch.name} za ${(item.price_cents * quantity / 100).toFixed(0)} zł.`,
      order_id: order[0]?.id,
      user_id: user_id
    };
    
    console.log("📤 Odpowiedź:", response);
    res.json(response);

  } catch (err) {
    console.error("🔥 Błąd orders endpoint:", err);
    res.status(500).json({ error: err.message });
  }
});

// === [8] USER ORDERS ENDPOINT ===
app.get("/api/user-orders", async (req, res) => {
  try {
    // Get user_id from Supabase Auth
    let user_id = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const { supabase } = await import('./api/_supabase.js');
        const token = authHeader.substring(7);
        const { data: { user }, error } = await supabase.auth.getUser(token);
        if (user && !error) {
          user_id = user.id;
          console.log("✅ User authenticated:", user.email, "ID:", user_id);
        }
      } catch (authError) {
        console.log("⚠️ Auth error:", authError.message);
      }
    }

    if (!user_id) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    // Initialize Supabase client
    const { supabase } = await import('./api/_supabase.js');

    // Get user orders
    const { data: orders, error } = await supabase
      .from('orders')
      .select(`
        *,
        restaurants (
          name,
          address,
          city
        )
      `)
      .eq('user_id', user_id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error("❌ Błąd pobierania zamówień:", error);
      return res.status(500).json({ error: "Błąd pobierania zamówień" });
    }

    console.log(`📋 Pobrano ${orders?.length || 0} zamówień dla użytkownika ${user_id}`);
    res.json({ orders: orders || [] });

  } catch (err) {
    console.error("❌ Błąd user-orders endpoint:", err);
    res.status(500).json({ error: err.message });
  }
});

// 🔧 Health check – działa pod /api/health
app.get("/api/health", async (req, res) => {
  const start = Date.now();

  const health = {
    ok: true,
    service: "FreeFlow Voice Expert",
    version: process.env.npm_package_version || "unknown",
    node: process.version,
    timestamp: new Date().toISOString(),
    supabase: { ok: false, time: null },
    tts: { ok: false, time: null },
    openai: !!process.env.OPENAI_API_KEY,
  };

  try {
    // 🔹 Supabase check
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    const t0 = performance.now();
    const { data, error } = await supabase.from("restaurants").select("id").limit(1);
    const t1 = performance.now();

    if (error) throw error;
    health.supabase.ok = true;
    health.supabase.time = `${(t1 - t0).toFixed(1)} ms`;
  } catch (err) {
    health.ok = false;
    health.supabase.error = err.message;
  }

  try {
    // 🔹 TTS check (Google key)
    const t0 = performance.now();
    if (process.env.GOOGLE_TTS_API_KEY) {
      health.tts.ok = true;
    }
    const t1 = performance.now();
    health.tts.time = `${(t1 - t0).toFixed(1)} ms`;
  } catch (err) {
    health.ok = false;
    health.tts.error = err.message;
  }

  health.responseTime = `${Date.now() - start} ms`;
  res.json(health);
});

// --- WebSocket Server Setup ---

const PORT = process.env.PORT || 3000;

// Utwórz HTTP server
const server = createServer(app);

// Utwórz WebSocket server
const wss = new WebSocketServer({ 
  server,
  path: '/api/stt-stream'
});

wss.on('connection', (ws, req) => {
  console.log('🔴 WebSocket client connected to STT stream');
  
  ws.on('message', (message) => {
    console.log('🔴 Received audio chunk:', message.length, 'bytes');
    // Tutaj będzie obsługa audio chunks
  });
  
  ws.on('close', () => {
    console.log('🔴 WebSocket client disconnected');
  });
  
  ws.on('error', (error) => {
    console.error('🔴 WebSocket error:', error);
  });
});

// Uruchom server
server.listen(PORT, () => console.log(`🚀 FreeFlow Voice Expert działa na porcie ${PORT}`));